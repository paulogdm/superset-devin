## Specification for Security Pipeline Presentation Tool

This tool visualizes the results of [devin-security-pipeline.yml](../.github/workflows/devin-security-pipeline.yml) across all pull requests in the repository.

## Data Source

Pull PR data from [https://github.com/paulogdm/superset-devin/pulls](https://github.com/paulogdm/superset-devin/pulls) (both open and closed) using the `gh` CLI tool. If `GITHUB_TOKEN` is not set or authentication fails, print a clear error explaining what is missing and how to set it up, then exit with a non-zero code.

## Parsing Logic

For each PR, find the comment authored by `devin-ai-integration` whose body starts with `## Security Pipeline Summary`. If a PR has no such comment, skip it silently.

Extract the following from the comment:

**Phase 1 — Initial Scan:**
Parse the findings table. Each row has: `Severity`, `Confidence`, `File`, `Line`, `Issue`. Collect all rows.

**Phase 2 — Automated Fixes:**
Parse the fixes table. Each row has: `Finding`, `Fix Applied`. Count how many findings were addressed.

**Phase 3 — Re-Scan:**
Capture the overall result (`PASS` or `FINDINGS`) and any remaining finding count.

**Overall Result block:**
Extract: initial findings count (and breakdown by severity), fixed count, remaining count, and status (`CLEAN` or `FINDINGS`).

### Severity normalization

Treat `INFO` and `LOW` as `OTHER`. Only include findings with confidence `medium` or higher. Recognized severities (after normalization) are: `CRITICAL`, `HIGH`, `MEDIUM`, `OTHER`.

## Terminal UI

The tool runs as an interactive terminal UI. Use a library appropriate for the implementation language (e.g., `rich`/`textual` for Python, `bubbletea` for Go, `ink` for Node.js).

### Overview screen (default view)

Show a summary across **all PRs** that have a Security Pipeline comment:

1. **Aggregate severity bar chart** — one horizontal bar per severity level (`CRITICAL`, `HIGH`, `MEDIUM`, `OTHER`), showing total issue count across all PRs. Display the raw count next to each bar.

2. **Fix effectiveness panel** — total issues found vs. total auto-fixed vs. total remaining. Show as both a number and a percentage (e.g., "42 found · 40 fixed (95%) · 2 remaining").

3. **Per-PR issue chart** — one row per PR, showing a stacked or grouped bar representing issue counts by severity. PRs with more issues should visually stand out. Label each row with the PR number and title (truncated if needed).

4. **Status summary line** — count of PRs by overall result: X CLEAN, Y with remaining findings.

### PR detail screen

Activated when the user selects a PR (arrow keys + Enter, or a number shortcut). Shows:

- PR title, number, URL, and open/closed state.
- Phase 1 findings table: severity, confidence, file, line, issue summary. Filter out findings below `medium` confidence and collapse `INFO`/`LOW` into `OTHER`.
- Phase 2 fixes table: what was found and what fix was applied.
- Phase 3 result: PASS or FINDINGS, with remaining count.
- A "back" action (Escape or `q`) to return to the overview.

### Navigation

- Arrow keys or `j`/`k` to move between PRs in the overview list.
- Enter to open PR detail.
- Escape or `q` to go back / exit.
- `r` to re-fetch data from GitHub (with a loading indicator).

## Error and Edge Cases

- If no PRs have a Security Pipeline comment, show a message explaining this instead of an empty screen.
- If `gh` is not installed, print a human-readable error and exit.
- If the API rate-limits, surface the reset time from the response headers.
- Gracefully handle malformed comments (skip the phase that cannot be parsed, log a warning to stderr).

## Implementation Notes

- The tool should be a single runnable script or small self-contained binary — no web server, no database.
- A Dockerfile that runs the tool is required. Use a minimal base image and document the `docker run` command needed to pass through GitHub credentials.
- All output is to the terminal. The program can use Markdown files to cache the comments of PRs, and avoid network requests to GitHub. So if it finds the file locally, it can use it, instead of fetching that from GitHub.
