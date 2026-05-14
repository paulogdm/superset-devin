# # Agentic GitHub Workflows — Spec

## Overview

This spec describes a system of AI agents triggered by GitHub events. Each agent operates autonomously within defined constraints: reading context, reasoning about it, and producing output (comments, reviews, or PRs) without human intervention unless escalation is warranted.

The system is built on:
- **GitHub Actions** — event ingress and trigger dispatch
- **Devin API** — autonomous agent execution (code reading, reasoning, writing, and GitHub interactions)
- **Devin Review API** — dedicated PR review endpoint (available as of May 2026)

Devin handles all GitHub interactions natively (browsing the codebase, pushing branches, opening PRs, posting inline comments). The Actions workflow is only responsible for detecting the event and calling the Devin API with the right prompt and context.

---

## Possible Workflows Dump

### 1. PR Opened — Security Scan

**Trigger:** `pull_request` event, actions: `[opened, synchronize]`

**Goal:** Detect security issues in the diff before human review begins.

**How it works:**

GitHub Actions calls `POST /v3/organizations/{org_id}/pr-reviews` (Devin Review API) with a security-focused prompt. Devin reads the diff directly, reasons about it, and posts structured inline and summary comments on the PR.

**Actions step:**
```yaml
- name: Trigger Devin security scan
  run: |
    curl -s -X POST \
      -H "Authorization: Bearer ${{ secrets.DEVIN_API_KEY }}" \
      -H "Content-Type: application/json" \
      -d '{
        "pull_request_url": "${{ github.event.pull_request.html_url }}",
        "prompt": "Review this PR for security issues only. Cover: OWASP Top 10, hardcoded secrets, dangerous function calls (eval/exec/shell=True), insecure deserialization, dependency additions, overly permissive IAM or file permissions, and auth bypass patterns. Skip documentation files and test files. Classify each finding as critical / high / medium / info. Post a summary comment with a findings table, and inline comments on each affected line. If any critical finding exists, request changes. If only high/medium, post as FYI without blocking. If nothing found, post a short pass comment."
      }' \
      "https://api.devin.ai/v3/organizations/${{ secrets.DEVIN_ORG_ID }}/pr-reviews"
```

**Expected Devin output on the PR:**

```
## Security Scan

| Severity | File | Line | Issue |
|----------|------|------|-------|
| HIGH     | src/auth.ts | 42 | JWT secret read from env without validation |
| MEDIUM   | Dockerfile | 12 | Running as root |

**Summary:** 1 high, 1 medium finding. Review required before merge.
```

**Gates:**
- `critical` findings → Devin requests changes (blocking review).
- `high` only → Devin posts comment, no blocking (configurable in prompt).
- `medium`/`info` only → FYI comment, no blocking.
- No findings → short pass comment.

**Prompt configuration (`.github/agents/security-prompt.txt`):**

Keep the security prompt in a versioned file and interpolate it into the Actions step. This allows tuning severity thresholds and skip paths without changing the workflow YAML.

---

### 2. PR Opened — Code Quality Review

**Trigger:** `pull_request` event, actions: `[opened, synchronize]`

**Goal:** Catch easy-to-fix issues and provide a second-opinion code review pass.

**How it works:**

GitHub Actions calls `POST /v3/organizations/{org_id}/pr-reviews`. Devin reads the PR description to infer intent, then reviews the diff for quality issues and posts inline comments + a summary.

**Actions step:**
```yaml
- name: Trigger Devin quality review
  run: |
    curl -s -X POST \
      -H "Authorization: Bearer ${{ secrets.DEVIN_API_KEY }}" \
      -H "Content-Type: application/json" \
      -d '{
        "pull_request_url": "${{ github.event.pull_request.html_url }}",
        "prompt": "Review this PR for code quality. First read the PR title and description to understand intent. Then check for: dead code or unreachable branches, missing error handling at system boundaries, N+1 queries or unbounded loops, naming inconsistencies with the surrounding codebase, missing or incorrect types, and test coverage gaps for new logic paths. Distinguish nitpicks (stylistic, non-blocking) from concerns (logic issues). Post inline comments on affected lines where possible. End with a summary comment listing concerns and nitpicks. Do not request changes — this review is advisory only. Do not suggest changes outside the diff scope."
      }' \
      "https://api.devin.ai/v3/organizations/${{ secrets.DEVIN_ORG_ID }}/pr-reviews"
```

**Expected Devin output on the PR:**

Inline comment on affected line:
```
[concern] This error is swallowed — callers won't know the operation failed.
```

Summary comment:
```
## Code Quality Review

**3 concerns, 2 nitpicks found.**

### Concerns
- `src/payment.ts:88` — error swallowed, propagate or log
- `src/payment.ts:104` — division without zero-check

### Nitpicks
- `src/utils.ts:12` — variable name `d` is ambiguous in this context

---
_Review generated by Devin (code-quality). Human review still required._
```

**Gates:**
- Devin never requests changes for quality issues — advisory only.
- Prompt instructs Devin to cap inline comments to 20 to avoid noise on large PRs.

---

### 3. Issue Opened — Automated Fix Attempt

**Trigger:** `issues` event, action: `opened`

**Goal:** For issues that are sufficiently narrow and well-defined, attempt a code fix and open a draft PR.

**How it works:**

GitHub Actions creates a Devin session via `POST /v1/sessions`. The prompt contains the full issue context and instructs Devin to: (1) triage the issue, (2) investigate the codebase, (3) implement a minimal fix, and (4) open a draft PR — or post a triage-failure comment if the issue doesn't meet the criteria.

Devin operates in its own sandbox with access to the repository and handles the branch, commit, and PR creation natively.

**Actions step:**
```yaml
- name: Trigger Devin issue fix
  run: |
    ISSUE_TITLE=$(echo '${{ github.event.issue.title }}' | jq -Rs .)
    ISSUE_BODY=$(echo '${{ github.event.issue.body }}' | jq -Rs .)
    ISSUE_NUMBER=${{ github.event.issue.number }}
    ISSUE_URL=${{ github.event.issue.html_url }}
    ISSUE_LABELS=$(echo '${{ toJson(github.event.issue.labels.*.name) }}')

    curl -s -X POST \
      -H "Authorization: Bearer ${{ secrets.DEVIN_API_KEY }}" \
      -H "Content-Type: application/json" \
      -d "{
        \"prompt\": \"You are an automated issue-fix agent for the repository ${{ github.repository }}.\n\nIssue #${ISSUE_NUMBER}: ${ISSUE_TITLE}\nURL: ${ISSUE_URL}\nLabels: ${ISSUE_LABELS}\n\nIssue body:\n${ISSUE_BODY}\n\n## Instructions\n\nFirst, triage the issue using these four criteria:\n1. Scope — Is this a single, bounded problem? Fail if it spans multiple subsystems or is a broad refactor request.\n2. Reproducibility — Is a failure path described or implied (error message, wrong output, missing behavior)?\n3. Locatability — Can you identify the relevant code from this description alone?\n4. Safety — Does the fix avoid schema migrations, secrets rotation, or external service changes?\n\nIf triage fails on any criterion, post a comment on issue #${ISSUE_NUMBER} explaining which criterion failed and why you are not attempting a fix. Then stop.\n\nIf triage passes:\n1. Investigate the codebase to find the root cause.\n2. Implement the minimal fix. Do not refactor beyond what is needed.\n3. Verify the fix does not introduce security issues and includes test changes if test files exist for the modified code.\n4. If the diff exceeds 200 lines changed, post a comment explaining the issue is too large for automated fixing and stop.\n5. Create a branch named 'agent/fix-issue-${ISSUE_NUMBER}'.\n6. Open a DRAFT pull request (not ready for review) with title 'fix: ${ISSUE_TITLE} (closes #${ISSUE_NUMBER})' and the label 'agent-generated'. The PR body must include: root cause, what changed and why, any caveats or open questions, and test coverage notes. End with: '_This PR was generated by the issue-fix agent. It is a draft — please review before marking ready for merge._'\n7. Do NOT push directly to main or master.\n8. Do NOT open the PR as ready for review.\"
      }" \
      "https://api.devin.ai/v1/sessions"
```

**Triage failure comment (posted by Devin on the issue):**
```
**Agent triage result: not attempting automated fix.**

Reason: This issue is too broad for autonomous resolution. It describes changes
across multiple subsystems. Please break it into smaller, scoped issues.
```

**Draft PR body (produced by Devin):**
```markdown
Closes #<issue_number>

## Root cause
<one paragraph>

## Fix
<what changed and why>

## Caveats / open questions
<anything Devin is uncertain about>

## Test coverage
<whether existing tests cover this or new ones were added>

---
_This PR was generated by the issue-fix agent. It is a draft — please review
before marking ready for merge._
```

**Guardrails (enforced via prompt instructions):**
- Always opens as **draft**, never ready-for-review.
- Never pushes to `main`/`master` directly.
- Adds `agent-generated` label.
- Maximum diff: 200 lines changed — aborts with comment if exceeded.
- Does not run if the issue has labels: `wontfix`, `needs-discussion`, `security`, or `blocked`.

**Label guard in Actions (before calling Devin):**
```yaml
- name: Check blocked labels
  id: label-check
  run: |
    LABELS='${{ toJson(github.event.issue.labels.*.name) }}'
    if echo "$LABELS" | grep -qE '"wontfix"|"needs-discussion"|"security"|"blocked"'; then
      echo "skip=true" >> $GITHUB_OUTPUT
    else
      echo "skip=false" >> $GITHUB_OUTPUT
    fi

- name: Trigger Devin issue fix
  if: steps.label-check.outputs.skip == 'false'
  run: |
    # ... curl call above
```

---

## Architecture

```
GitHub Event
     │
     ▼
GitHub Actions Workflow (.github/workflows/agents.yml)
     │
     ├── job: security-scan    (PR opened/sync)  ──► POST /v3/.../pr-reviews  ──► Devin reviews PR, posts comments
     │
     ├── job: quality-review   (PR opened/sync)  ──► POST /v3/.../pr-reviews  ──► Devin reviews PR, posts comments
     │
     └── job: issue-fix        (Issue opened)    ──► POST /v1/sessions        ──► Devin investigates, opens draft PR
```

The Actions workflow is thin — it only handles event detection, label guards, and the API call. All code reading, reasoning, branch creation, and GitHub interactions are performed by Devin in its own environment.

**Required secrets:**
- `DEVIN_API_KEY` — Devin service API key
- `DEVIN_ORG_ID` — Devin organization ID (needed for v3 Review API)
- `GITHUB_TOKEN` — already available in Actions (only needed for the label guard step)

---

## Devin Playbooks (optional but recommended)

Devin supports reusable **Playbooks** — saved prompt templates at the org level. Instead of embedding long prompts in the workflow YAML, you can register a playbook per workflow and reference it by ID in the API call. This makes prompt iteration easier and keeps the workflow YAML clean.

Suggested playbooks:
| Playbook name | Used by |
|---|---|
| `github-security-scan` | PR security scan |
| `github-quality-review` | PR quality review |
| `github-issue-fix` | Issue fix attempt |

---

## Open Questions / To Refine

1. **Review API vs. sessions for PR workflows** — The dedicated `POST /v3/.../pr-reviews` endpoint is purpose-built for PR review and is preferred. Confirm whether it supports the "request changes" gate behavior or if that requires a follow-up `gh` call.
2. **Re-run behavior** — Should the agent re-run on `synchronize` (new commits pushed to a PR)? If yes, add idempotency: check if Devin already commented and skip or update rather than posting a duplicate.
3. **Session polling** — The issue-fix session is async. The Actions job can exit after triggering it (fire-and-forget), or poll `GET /v1/sessions/{session_id}` until Devin finishes and report status back to the issue. Decide which UX is preferred.
4. **Escalation path** — For `critical` security findings, should Devin also @-mention a security team or post to a Slack channel? Can be added to the prompt or handled with a webhook from Devin.
5. **Manual trigger** — Should the issue-fix also respond to an `issue_comment` event when someone comments `/fix`? Simple to add as a second trigger in the workflow.
6. **Monorepo support** — If this is a monorepo, scope the issue-fix prompt to the relevant package by parsing the issue labels or body for package name hints.
7. **Cost / ACU tracking** — Devin v3 analytics API provides per-product ACU consumption. Set up a budget alert and consider adding a diff-size pre-check in Actions before calling Devin on very large PRs.
8. **Devin org ID** — Confirm the org ID to use for the v3 Review API endpoint. This is found in Devin settings.
