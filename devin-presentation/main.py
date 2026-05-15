#!/usr/bin/env python3
"""Security Pipeline Presentation Tool.

Fetches and visualizes devin-ai-integration Security Pipeline Summary comments
across all PRs in paulogdm/superset-devin, with a local Markdown cache.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from rich.text import Text
from textual import on
from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.containers import ScrollableContainer, Vertical
from textual.screen import Screen
from textual.widgets import DataTable, Footer, Header, Static

REPO = "paulogdm/superset-devin"
CACHE_DIR = Path("cache")
BAR_WIDTH = 36

SEVERITY_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "OTHER"]
SEVERITY_COLORS = {
    "CRITICAL": "bold red",
    "HIGH": "dark_orange",
    "MEDIUM": "yellow",
    "OTHER": "dim white",
}


# ── Data models ───────────────────────────────────────────────────────────────

@dataclass
class Finding:
    severity: str
    confidence: str
    file: str
    line: str
    issue: str


@dataclass
class Fix:
    finding: str
    fix_applied: str


@dataclass
class PRSummary:
    number: int
    title: str
    url: str
    state: str
    phase1_findings: list[Finding] = field(default_factory=list)
    phase2_fixes: list[Fix] = field(default_factory=list)
    phase3_result: str = ""
    phase3_remaining: int = 0
    overall_status: str = ""
    overall_initial: int = 0
    overall_fixed: int = 0
    overall_remaining: int = 0
    parse_errors: list[str] = field(default_factory=list)

    def severity_counts(self) -> dict[str, int]:
        counts: dict[str, int] = {s: 0 for s in SEVERITY_ORDER}
        for f in self.phase1_findings:
            counts[f.severity] += 1
        return counts

    def total_findings(self) -> int:
        return len(self.phase1_findings)


# ── Parsing ───────────────────────────────────────────────────────────────────

def _normalize_severity(sev: str) -> str:
    s = sev.strip().upper()
    return s if s in ("CRITICAL", "HIGH", "MEDIUM") else "OTHER"


def _confidence_ok(conf: str) -> bool:
    return conf.strip().lower() in ("high", "medium")


def _parse_md_table(text: str) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    headers: list[str] = []
    for line in text.splitlines():
        line = line.strip()
        if not line.startswith("|"):
            continue
        if re.match(r"^\|[-| :]+\|$", line):
            continue
        cells = [c.strip() for c in line.strip("|").split("|")]
        if not headers:
            headers = cells
        elif len(cells) >= len(headers):
            # Merge overflow cells into the last column (Issue can contain `|`)
            merged = cells[: len(headers) - 1] + [" | ".join(cells[len(headers) - 1 :])]
            rows.append(dict(zip(headers, merged)))
    return rows


def _section(body: str, name: str, stop: str = r"###|\Z") -> str | None:
    m = re.search(
        rf"### {re.escape(name)}[^\n]*\n(.*?)(?={stop})",
        body,
        re.DOTALL,
    )
    return m.group(1) if m else None


def parse_comment(body: str) -> dict[str, Any]:
    r: dict[str, Any] = {
        "phase1": [],
        "phase2": [],
        "phase3_result": "",
        "phase3_remaining": 0,
        "overall_status": "",
        "overall_initial": 0,
        "overall_fixed": 0,
        "overall_remaining": 0,
        "errors": [],
    }

    # Phase 1
    p1 = _section(body, "Phase 1", r"### Phase 2|### Phase 3|### Overall|\Z")
    if p1:
        try:
            for row in _parse_md_table(p1):
                sev_raw = row.get("Severity", "").strip("`").strip()
                conf = row.get("Confidence", "")
                if not _confidence_ok(conf):
                    continue
                r["phase1"].append({
                    "severity": _normalize_severity(sev_raw),
                    "confidence": conf.strip(),
                    "file": row.get("File", "").strip("`"),
                    "line": row.get("Line", ""),
                    "issue": row.get("Issue", ""),
                })
        except Exception as exc:
            r["errors"].append(f"Phase 1 parse error: {exc}")
    else:
        r["errors"].append("Phase 1 section not found")

    # Phase 2
    p2 = _section(body, "Phase 2", r"### Phase 3|### Overall|\Z")
    if p2:
        try:
            for row in _parse_md_table(p2):
                r["phase2"].append({
                    "finding": row.get("Finding", ""),
                    "fix_applied": row.get("Fix Applied", ""),
                })
        except Exception as exc:
            r["errors"].append(f"Phase 2 parse error: {exc}")
    else:
        r["errors"].append("Phase 2 section not found")

    # Phase 3
    p3 = _section(body, "Phase 3", r"### Overall|\Z")
    if p3:
        m = re.search(r"\*\*Result:\s*(PASS|FINDINGS)\*\*", p3)
        if m:
            r["phase3_result"] = m.group(1)
        if r["phase3_result"] == "FINDINGS":
            rm = re.search(r"(\d+)\s+(?:security\s+)?finding", p3)
            if rm:
                r["phase3_remaining"] = int(rm.group(1))
    else:
        r["errors"].append("Phase 3 section not found")

    # Overall Result
    ov = _section(body, "Overall Result")
    if ov:
        for pattern, key in [
            (r"\*\*Initial findings\*\*[^:]*:\s*(\d+)", "overall_initial"),
            (r"\*\*Fixed\*\*[^:]*:\s*(\d+)", "overall_fixed"),
            (r"\*\*Remaining[^*]*\*\*[^:]*:\s*(\d+)", "overall_remaining"),
        ]:
            m2 = re.search(pattern, ov)
            if m2:
                r[key] = int(m2.group(1))
        sm = re.search(r"\*\*Status\*\*[^:]*:[^A-Z]*([A-Z]+)", ov)
        if sm:
            r["overall_status"] = sm.group(1)
    else:
        r["errors"].append("Overall Result section not found")

    return r


# ── Data fetching ─────────────────────────────────────────────────────────────

def _gh(*args: str) -> str:
    try:
        proc = subprocess.run(["gh", *args], capture_output=True, text=True, check=True)
        return proc.stdout
    except FileNotFoundError:
        sys.exit(
            "Error: 'gh' CLI is not installed.\n"
            "Install it from https://cli.github.com/ or use the Docker image."
        )
    except subprocess.CalledProcessError as exc:
        err = (exc.stderr or exc.stdout or "").strip()
        if "rate limit" in err.lower():
            reset = re.search(r"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})", err)
            extra = f" Resets at {reset.group(1)}." if reset else ""
            sys.exit(f"GitHub API rate limited.{extra}")
        if "401" in err or "authentication" in err.lower() or "credentials" in err.lower():
            sys.exit(
                "GitHub authentication failed.\n"
                "Set the GITHUB_TOKEN environment variable or run: gh auth login"
            )
        sys.exit(f"gh error: {err}")


def _gh_json(*args: str) -> Any:
    raw = _gh(*args)
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        # gh --paginate can emit concatenated JSON arrays; parse them all
        dec = json.JSONDecoder()
        items: list[Any] = []
        pos, raw = 0, raw.strip()
        while pos < len(raw):
            obj, pos = dec.raw_decode(raw, pos)
            items.extend(obj if isinstance(obj, list) else [obj])
            while pos < len(raw) and raw[pos] in " \t\n\r":
                pos += 1
        return items


def _cached_comment(pr: int) -> str | None:
    path = CACHE_DIR / f"{pr}.md"
    return path.read_text() if path.exists() else None


def _cache_comment(pr: int, body: str) -> None:
    CACHE_DIR.mkdir(exist_ok=True)
    (CACHE_DIR / f"{pr}.md").write_text(body)


def fetch_prs() -> list[dict]:
    return _gh_json(
        "pr", "list", "--repo", REPO,
        "--state", "all",
        "--json", "number,title,url,state",
        "--limit", "200",
    )


def fetch_comment(pr: int) -> str | None:
    cached = _cached_comment(pr)
    if cached is not None:
        return cached

    comments = _gh_json("api", f"repos/{REPO}/issues/{pr}/comments?per_page=100")
    for c in comments:
        login: str = c.get("user", {}).get("login", "")
        body: str = c.get("body", "")
        if "devin-ai-integration" in login and body.lstrip().startswith("## Security Pipeline Summary"):
            _cache_comment(pr, body)
            return body
    return None


def load_all_data(force_refresh: bool = False) -> list[PRSummary]:
    if force_refresh and CACHE_DIR.exists():
        for f in CACHE_DIR.glob("*.md"):
            f.unlink()

    prs_raw = fetch_prs()
    result: list[PRSummary] = []
    for raw in prs_raw:
        body = fetch_comment(raw["number"])
        if body is None:
            continue
        parsed = parse_comment(body)
        pr = PRSummary(
            number=raw["number"],
            title=raw["title"],
            url=raw["url"],
            state=raw.get("state", "UNKNOWN").upper(),
            phase1_findings=[Finding(**f) for f in parsed["phase1"]],
            phase2_fixes=[Fix(**f) for f in parsed["phase2"]],
            phase3_result=parsed["phase3_result"],
            phase3_remaining=parsed["phase3_remaining"],
            overall_status=parsed["overall_status"],
            overall_initial=parsed["overall_initial"],
            overall_fixed=parsed["overall_fixed"],
            overall_remaining=parsed["overall_remaining"],
            parse_errors=parsed["errors"],
        )
        for err in pr.parse_errors:
            print(f"[warn] PR #{pr.number}: {err}", file=sys.stderr)
        result.append(pr)
    return result


# ── TUI helpers ───────────────────────────────────────────────────────────────

def _bar(count: int, max_val: int, width: int, color: str) -> Text:
    filled = max(1, round(count / max_val * width)) if max_val > 0 and count > 0 else 0
    t = Text()
    t.append("█" * filled, style=color)
    t.append("░" * (width - filled), style="dim")
    t.append(f" {count}", style="bold")
    return t


def _trunc(s: str, n: int) -> str:
    return s[: n - 1] + "…" if len(s) > n else s


# ── Detail screen ─────────────────────────────────────────────────────────────

class DetailScreen(Screen):
    BINDINGS = [Binding("escape,q", "app.pop_screen", "Back")]

    def __init__(self, pr: PRSummary) -> None:
        super().__init__()
        self.pr = pr

    def compose(self) -> ComposeResult:
        yield Header(show_clock=False)
        with ScrollableContainer():
            state_style = "green" if self.pr.state == "OPEN" else "dim"
            yield Static(
                f"[bold]PR #{self.pr.number}[/bold]: {self.pr.title}  "
                f"[{state_style}][{self.pr.state}][/{state_style}]\n"
                f"[link={self.pr.url}]{self.pr.url}[/link]\n"
            )

            yield Static("[bold underline]Phase 1 — Initial Scan[/bold underline]")
            if self.pr.phase1_findings:
                t1: DataTable = DataTable(cursor_type="none", zebra_stripes=True)
                t1.add_columns("Severity", "Conf", "File", "Line", "Issue")
                for f in self.pr.phase1_findings:
                    c = SEVERITY_COLORS[f.severity]
                    t1.add_row(
                        Text(f.severity, style=c),
                        f.confidence,
                        _trunc(f.file, 40),
                        f.line,
                        _trunc(f.issue, 72),
                    )
                yield t1
            else:
                yield Static("[dim]No findings (after confidence ≥ medium filter)[/dim]")

            yield Static("\n[bold underline]Phase 2 — Automated Fixes[/bold underline]")
            if self.pr.phase2_fixes:
                t2: DataTable = DataTable(cursor_type="none", zebra_stripes=True)
                t2.add_columns("Finding", "Fix Applied")
                for fix in self.pr.phase2_fixes:
                    t2.add_row(_trunc(fix.finding, 55), _trunc(fix.fix_applied, 80))
                yield t2
            else:
                yield Static("[dim]No fixes recorded[/dim]")

            yield Static("\n[bold underline]Phase 3 — Re-Scan[/bold underline]")
            match self.pr.phase3_result:
                case "PASS":
                    yield Static("[bold green]✅ PASS[/bold green] — no findings detected after fixes.")
                case "FINDINGS":
                    yield Static(
                        f"[bold red]❌ FINDINGS[/bold red] — {self.pr.phase3_remaining} remaining."
                    )
                case _:
                    yield Static("[dim]Phase 3 data unavailable[/dim]")

            yield Static("\n[bold underline]Overall Result[/bold underline]")
            icon = "✅" if self.pr.overall_status == "CLEAN" else "❌"
            yield Static(
                f"{icon} [bold]{self.pr.overall_status or 'UNKNOWN'}[/bold]\n"
                f"Initial: {self.pr.overall_initial}  "
                f"Fixed: {self.pr.overall_fixed}  "
                f"Remaining: {self.pr.overall_remaining}"
            )
        yield Footer()


# ── Overview screen ───────────────────────────────────────────────────────────

class OverviewScreen(Screen):
    BINDINGS = [
        Binding("q", "app.exit_app", "Quit"),
        Binding("r", "app.request_refresh", "Refresh"),
    ]

    def __init__(self, prs: list[PRSummary]) -> None:
        super().__init__()
        self.prs = prs

    def compose(self) -> ComposeResult:
        yield Header(show_clock=False)
        with Vertical():
            yield Static(id="aggregate")
            yield Static(id="effectiveness")
            yield Static(
                "[bold]Per-PR Issues[/bold]  "
                "[dim]↑↓ navigate · Enter drill in · r refresh · q quit[/dim]"
            )
            yield DataTable(id="pr-table", cursor_type="row", zebra_stripes=True)
            yield Static(id="status-line")
        yield Footer()

    def on_mount(self) -> None:
        self._render_all()

    def _render_all(self) -> None:
        self._render_aggregate()
        self._render_effectiveness()
        self._render_pr_table()
        self._render_status_line()

    def _render_aggregate(self) -> None:
        totals: dict[str, int] = {s: 0 for s in SEVERITY_ORDER}
        for pr in self.prs:
            for sev, n in pr.severity_counts().items():
                totals[sev] += n
        max_val = max(totals.values(), default=1)
        lines = ["[bold]Aggregate Findings by Severity[/bold]"]
        for sev in SEVERITY_ORDER:
            n = totals[sev]
            c = SEVERITY_COLORS[sev]
            filled = max(1, round(n / max_val * BAR_WIDTH)) if n > 0 else 0
            bar = f"[{c}]{'█' * filled}[/{c}][dim]{'░' * (BAR_WIDTH - filled)}[/dim]"
            lines.append(f"[{c}]{sev:<8}[/{c}] {bar} [bold]{n}[/bold]")
        self.query_one("#aggregate", Static).update("\n".join(lines))

    def _render_effectiveness(self) -> None:
        total_i = sum(p.overall_initial for p in self.prs)
        total_f = sum(p.overall_fixed for p in self.prs)
        total_r = sum(p.overall_remaining for p in self.prs)
        pct = round(total_f / total_i * 100) if total_i else 0
        r_style = "red" if total_r else "green"
        self.query_one("#effectiveness", Static).update(
            f"[bold]Fix Effectiveness[/bold]\n"
            f"{total_i} found · [green]{total_f} fixed ({pct}%)[/green] · "
            f"[{r_style}]{total_r} remaining[/{r_style}]"
        )

    def _render_pr_table(self) -> None:
        table = self.query_one("#pr-table", DataTable)
        table.clear(columns=True)
        table.add_columns("PR", "Title", "CRIT", "HIGH", "MED", "OTHER", "Bar", "Status")
        max_total = max((p.total_findings() for p in self.prs), default=1)
        for pr in self.prs:
            counts = pr.severity_counts()
            total = pr.total_findings()
            bar_color = (
                "red" if counts["CRITICAL"] else
                "dark_orange" if counts["HIGH"] else
                "yellow" if counts["MEDIUM"] else
                "dim"
            )
            bar = _bar(total, max_total, 20, bar_color)
            icon = "✅" if pr.overall_status == "CLEAN" else ("❌" if pr.overall_status else "?")

            def _cell(n: int, style: str) -> Text:
                return Text(str(n), style=style) if n else Text("—", style="dim")

            table.add_row(
                f"#{pr.number}",
                _trunc(pr.title, 38),
                _cell(counts["CRITICAL"], "bold red"),
                _cell(counts["HIGH"], "dark_orange"),
                _cell(counts["MEDIUM"], "yellow"),
                _cell(counts["OTHER"], "dim white"),
                bar,
                icon,
                key=str(pr.number),
            )
        table.focus()

    def _render_status_line(self) -> None:
        clean = sum(1 for p in self.prs if p.overall_status == "CLEAN")
        bad = sum(1 for p in self.prs if p.overall_status and p.overall_status != "CLEAN")
        unknown = len(self.prs) - clean - bad
        parts: list[str] = [f"[green]{clean} CLEAN[/green]"]
        if bad:
            parts.append(f"[red]{bad} with remaining findings[/red]")
        if unknown:
            parts.append(f"[dim]{unknown} status unknown[/dim]")
        self.query_one("#status-line", Static).update(" · ".join(parts))

    @on(DataTable.RowSelected)
    def on_row_selected(self, event: DataTable.RowSelected) -> None:
        idx = event.cursor_row
        if 0 <= idx < len(self.prs):
            self.app.push_screen(DetailScreen(self.prs[idx]))


# ── Empty / no-data screen ────────────────────────────────────────────────────

class EmptyScreen(Screen):
    BINDINGS = [Binding("q,escape", "app.exit_app", "Quit")]

    def compose(self) -> ComposeResult:
        yield Header(show_clock=False)
        yield Static(
            "\n[yellow]No PRs with a 'Security Pipeline Summary' comment were found.[/yellow]\n\n"
            "[dim]Ensure devin-ai-integration has commented on at least one PR in[/dim]\n"
            f"[dim]{REPO}[/dim]"
        )
        yield Footer()


# ── App ───────────────────────────────────────────────────────────────────────

class SecurityDashboard(App):
    TITLE = "Security Pipeline Dashboard"
    CSS = """
    Screen        { background: $surface; }
    #aggregate    { border: round $primary; padding: 1; margin-bottom: 1; }
    #effectiveness{ border: round $secondary; padding: 1; margin-bottom: 1; }
    #pr-table     { height: auto; max-height: 14; margin-bottom: 0; }
    #status-line  { padding: 0 1; margin-top: 1; }
    ScrollableContainer { padding: 1; }
    DataTable     { height: auto; }
    """

    def __init__(self, prs: list[PRSummary]) -> None:
        super().__init__()
        self._prs = prs
        self.refresh_requested = False

    def on_mount(self) -> None:
        if self._prs:
            self.push_screen(OverviewScreen(self._prs))
        else:
            self.push_screen(EmptyScreen())

    def action_exit_app(self) -> None:
        self.exit()

    def action_request_refresh(self) -> None:
        self.refresh_requested = True
        self.exit()

    def action_pop_screen(self) -> None:
        if len(self.screen_stack) > 1:
            self.pop_screen()


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    force = "--refresh" in sys.argv
    while True:
        print("Fetching PR data…", flush=True)
        prs = load_all_data(force_refresh=force)
        app = SecurityDashboard(prs)
        app.run()
        if not app.refresh_requested:
            break
        force = True
        print("Refreshing…", flush=True)
