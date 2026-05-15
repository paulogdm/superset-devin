# Security Pipeline Dashboard

A terminal UI tool that visualizes the results of [`devin-security-pipeline.yml`](../.github/workflows/devin-security-pipeline.yml) across all pull requests in the repository.

It scans each PR for a comment by `devin-ai-integration` starting with `## Security Pipeline Summary`, parses the three-phase report (initial scan → auto-fix → re-scan), and presents the data as an interactive dashboard.

## What it shows

- **Aggregate severity chart** — total findings across all PRs, broken down by CRITICAL / HIGH / MEDIUM / OTHER
- **Fix effectiveness** — how many issues were found, auto-fixed, and remain
- **Per-PR table** — one row per PR with severity counts and a proportional bar
- **PR detail view** — full Phase 1/2/3 tables for any selected PR

## Running locally

```bash
pip install -r requirements.txt
python main.py
```

Requires the [`gh` CLI](https://cli.github.com/) and a valid GitHub token (`gh auth login` or `GITHUB_TOKEN` env var).

## Running with Docker

```bash
docker build -t security-pipeline-dashboard .

docker run -it \
  -e GITHUB_TOKEN="$GITHUB_TOKEN" \
  -e TERM=xterm-256color \
  -v "$(pwd)/cache:/app/cache" \
  security-pipeline-dashboard
```

## Caching

PR comments are cached as Markdown files in `cache/` (one file per PR number). On subsequent runs the tool reads from cache instead of hitting the GitHub API. To force a fresh fetch:

```bash
# locally
python main.py --refresh

# Docker
docker run -it -e GITHUB_TOKEN="$GITHUB_TOKEN" -e TERM=xterm-256color \
  -v "$(pwd)/cache:/app/cache" security-pipeline-dashboard --refresh
```

## Navigation

| Key | Action |
|-----|--------|
| `↑` / `↓` or `j` / `k` | Move between PRs |
| `Enter` | Open PR detail |
| `Escape` / `q` | Go back / quit |
| `r` | Refresh data from GitHub |
