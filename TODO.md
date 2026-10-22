# Factory: to do

Goal: **minimize cost while keeping (or raising) the quality of what reaches main.**
Not loaded by the skill; this is the improvement backlog for the factory itself.

## Evidence (fitness-app, job 001-workout-share-card, 2026-10-21)

One feature, 3 review rounds + 1 rework, 19 subagents.

| Who | API calls | Output | Input + cache write | Cache read |
|---|---|---|---|---|
| Orchestrator (main session) | 67 | 23k | 125k | **7.5M** |
| Builder ×3 (opus) | 42 | 5.3k | 142k | 1.19M |
| Approver ×3 (opus) | 19 | 6.1k | 66k | 303k |
| Security ×3 (opus) | 15 | 3.0k | 70k | 191k |
| Spec-writer (opus) | 8 | 3.7k | 27k | 109k |
| Code ×3 (sonnet) | 13 | 0.8k | 74k | 161k |
| UX ×3 (sonnet) | 10 | 1.2k | 51k | 74k |
| UI ×3 (sonnet) | 13 | 0.2k | 46k | 112k |

Takeaways:
1. **The orchestrator is ~half of the whole job's cost.** Its context keeps growing (a ~700-line
   SKILL.md, agent results, status checks) and every one of its 67 calls re-reads all of it.
2. The builder is the biggest subagent: its later rounds re-read a large context (634k cache reads in round 3).
3. Every review round re-ran all 4 reviewers even when only one asked for changes.
4. UX/UI reviewers write tiny outputs (23-951 tokens). They are mostly reading, so they can run on cheaper settings.
5. The approver ran 3 times on opus.

Re-measure after each change below with the dashboard (agents & tokens) and compare against this table.

## P1: biggest savings

- [ ] **Slim the orchestrator.**
  - Split SKILL.md: keep only the core loop in it (~150 lines), and move hello/bye, test,
    rework/reject, resume, dashboard and the Orca details into `reference/*.md`, read only
    when that command runs.
  - Never read full agent output into the orchestrator. Read only first lines (verdicts,
    STATUS, decision) with `head -1`; the dashboard and the human read the full files.
  - Keep status lines to one short line; don't quote files back unless asked.
  - Recommend running the orchestrator on Sonnet (`/model sonnet` before `/factory`). Its work
    is mechanical: spawn, read first lines, update job.json. Test whether quality holds.
  - Consider a small `scripts/job.js` helper (create job, set stage, record verdict, merge-tree
    check) so the orchestrator makes one Bash call instead of several reads and writes.
- [ ] **Re-review only what's needed.** In round N+1, re-run the reviewers that said CHANGES
  plus the code reviewer (the code changed). Carry PASS verdicts forward for untouched lenses,
  unless the fix touched files in their area (UI files → UI/UX; auth/input → security).
- [ ] **Size and risk routing (see table below).** The spec-writer adds `Size:` and `Risk:`
  lines. The orchestrator passes `model` and `effort` on each Agent call from the routing table.
- [ ] **Quota guard.** Read `~/.claude/factory/quota.json` before spawning. If 5h left < 15%,
  don't start new jobs (finish running ones), say when the window resets, and let
  `/factory hello` suggest waiting.

## P2: solid savings

- [ ] **Precompute the diff once per round.** The orchestrator writes `round-N/diff.patch` and
  `round-N/files.txt`; reviewers read those instead of each running git log/diff (same input
  for all 4, better cache reuse, fewer tool calls).
- [ ] **Per-job token budget.** Add a `scripts/usage.js <repo> <job-id>` CLI (reuse serve.js
  logic). If a job passes its budget (S 400k, M 1M, L 2.5M weighted tokens, tune with data),
  stop and escalate with "over budget" instead of starting another round.
- [ ] **Cheaper approver.** When all 4 PASS and no risky path is touched, run the approver on
  sonnet/low; keep opus for risky diffs. The escalation rules are mostly path-based, so a
  script can pre-check them and give the approver a short list.
- [ ] **Fast lane for size S, risk low** (copy change, small UI tweak, config value): skip the
  spec-writer (the builder writes a 10-line mini-spec at the top of build.md), and run only
  code + one merged "ux/ui" reviewer on sonnet/low. Human test gate unchanged.
- [ ] **Builder context hygiene.** On resume, point the builder only at the CHANGES findings,
  not every review file; tell it not to re-read files it already changed unless needed.

## P3: measure and tune

- [ ] Record per job in job.json at the end: weighted tokens, rounds, escalated?, human rework?
- [ ] `/factory bye` adds a "Cost" line to the journal (tokens per job, per role).
- [ ] Weekly: if S-sized jobs often need rework → raise their builder effort; if reviewers on
  low never catch anything the human later finds → keep low; if they miss things → raise.
- [ ] Try Haiku for the UX/UI reviewers of tiny diffs; compare findings with sonnet on a few jobs.

## Proposed routing table (to validate with data)

The spec-writer decides **Size** and **Risk** from signals it already sees:

| Signal | S | M | L |
|---|---|---|---|
| Files likely touched | 1-2 | 3-6 | 7+ |
| Kind of change | copy, style, config, one small component | new component/endpoint, logic in one area | cross-cutting, data model, new subsystem |
| Acceptance criteria | ≤ 4 | 5-9 | 10+ |
| Assumptions it had to make | 0-1 | 2-3 | 4+ |

**Risk: high** if it touches auth, permissions, payments, user input to SQL/shell/HTML,
file uploads, secrets, migrations, deploy/CI, or sends email. Otherwise low.

| Role | S / low risk | M | L or high risk |
|---|---|---|---|
| spec-writer | (skipped, fast lane) | opus · medium | opus · high |
| builder | sonnet · medium | opus · medium | opus · high |
| security | sonnet · low | sonnet · medium | opus · high |
| code | sonnet · low | sonnet · medium | sonnet · high |
| ux / ui | sonnet · low (merged) | sonnet · low | sonnet · medium |
| approver | sonnet · low | sonnet · medium | opus · medium |
| orchestrator | sonnet (session model) | sonnet | sonnet or opus |

Escalate the effort automatically on a retry: if a round comes back with CHANGES, the next
builder run goes one effort step up (low → medium → high), capped by MAX_RESUMES.

## Other improvements (not cost)

- [ ] Run one full end-to-end job on a throwaway repo after each big change (we have only one real run).
- [ ] Old agents in job 001 lack the job-id prefix, so the dashboard can't count them; one-off
  backfill by matching descriptions ("Security review round 1") to job folders.
- [ ] Orca may rewrite the status line setting on update; `/factory hello` should check and offer to re-chain.
- [ ] Dashboard: a cost column per job and a "this week" total, from the same usage data.
