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

- [x] **Slim the orchestrator.** (2026-10-22)
  - SKILL.md 31.6 KB → 8.2 KB; test/approve/rework/reject, parallel, resume, hello/bye and
    dashboard moved to `reference/*.md`, read only when that command runs.
  - `scripts/factory.js` does all bookkeeping (setup, new, worktree, set, agent, overlap,
    route, round, verdicts, build, decision, conflict, cost, quota, claim, status) and prints
    one line of JSON; it also keeps Orca cards in sync.
  - The orchestrator reads only first lines / single sections, never whole agent files.
  - Skill frontmatter runs the orchestrator on `model: sonnet`, `effort: medium`.
    **Verified 2026-10-22:** it only holds for the turn `/factory` was typed in; turns
    triggered by finished background agents run on the session model (Opus in the test).
    Mitigation: SKILL.md tells the user once to `/model sonnet`. Option to explore:
    `context: fork` with a Sonnet orchestrator subagent, if forked skills can spawn agents.
- [x] **Re-review only what's needed.** `F round` re-runs reviewers that said CHANGES plus code;
  carries PASS forward unless the changes since the last reviewed commit touch front-end files
  (ux/ui) or risky files (security). Tested on a throwaway repo.
- [x] **Size and risk routing.** Spec-writer writes `Size:` / `Risk:`; `F route <id> <role>`
  returns model + effort (table below). `FACTORY_ROUTING=off` falls back to agent defaults.
- [x] **Quota guard.** `F new` refuses when the 5-hour window has < 15% left (unless `--force`
  after the user agrees); stale quota data (> 15 min) is ignored. `hello` shows the quota.

## P2: solid savings

- [x] **Precompute the diff once per round.** `F round` writes `round-N/diff.patch` and
  `files.txt`; reviewers and the approver read them.
- [x] **Per-job token budget.** `F cost <id>` (shared `scripts/lib/usage.js`); the orchestrator
  stops with "over token budget" before starting another round (S 400k, M 1M, L 2.5M weighted).
- [x] **Cheaper approver.** Routed by size/risk (sonnet/low for S); `F round` passes the risky
  paths so the approver checks those first; the merge-tree check is done by `F conflict`.
- [ ] **Fast lane for size S, risk low** (copy change, small UI tweak, config value): skip the
  spec-writer (the builder writes a 10-line mini-spec at the top of build.md), and run only
  code + one merged "ux/ui" reviewer on sonnet/low. Human test gate unchanged.
  Blocked on: size is only known after the spec. Option: a cheap haiku pre-classifier.
- [x] **Builder context hygiene.** Fix rounds spawn a fresh builder told to read build.md and only
  the CHANGES reviews (no more resumed builders re-reading 600k+ tokens of old context; also lets
  `F route` raise the effort).

## P3: measure and tune

- [x] Record per job in job.json at the end: `F cost <id> --save` at needs-human (weighted tokens,
  agents, raw tokens). Still missing: rounds-to-pass, escalated?, human rework? as fields.
- [x] `/factory bye` adds a "Cost" line to the journal.
- [x] **Run one real end-to-end job on a throwaway repo with the new flow.** (2026-10-22)
  textkit, "add truncate(text, maxLength) with tests": spec (opus·medium) → build (sonnet·medium)
  → security + code (sonnet·low; ux/ui skipped, no front end) → approver (sonnet·low) → APPROVE
  in 1 round → merged. **5 agents, 79k weighted tokens** (output 317, cache read 137k,
  input+cache write 51k), about 2 minutes of agent time. For comparison, job 001 in fitness-app
  (larger, UI-heavy, 3 rounds) used 19 agents and ~2.1M cache reads before these changes.
  Bugs found and fixed during the run: token counting missed agents whose orchestrator session
  lives in another project folder; the Sonnet frontmatter doesn't survive background turns.
  Still untested: Orca worktree creation through `F worktree`, a fix round (CHANGES), a base sync.
- [ ] Weekly: if S-sized jobs often need rework → raise their builder effort; if reviewers on
  low never catch anything the human later finds → keep low; if they miss things → raise.
- [ ] Try Haiku for the UX/UI reviewers of tiny diffs; compare findings with sonnet on a few jobs.

## Routing table (validate with data)

The spec-writer decides **Size** and **Risk** from signals it already sees:

| Signal | S | M | L |
|---|---|---|---|
| Files likely touched | 1-2 | 3-6 | 7+ |
| Kind of change | copy, style, config, one small component | new component/endpoint, logic in one area | cross-cutting, data model, new subsystem |
| Acceptance criteria | ≤ 4 | 5-9 | 10+ |
| Assumptions it had to make | 0-1 | 2-3 | 4+ |

**Risk: high** if it touches auth, permissions, payments, user input to SQL/shell/HTML,
file uploads, secrets, migrations, deploy/CI, or sends email. Otherwise low.

Implemented in `scripts/factory.js` (`TABLE` and `cmds.route`); tune it there:

| Role | S | M | L | Risk: high overrides |
|---|---|---|---|---|
| spec-writer | opus · medium | opus · medium | opus · medium | (size unknown yet) |
| builder | sonnet · medium | opus · medium | opus · high | sonnet → opus |
| security | sonnet · low | sonnet · medium | opus · high | opus · high |
| code | sonnet · low | sonnet · medium | sonnet · high | |
| ux / ui | sonnet · low | sonnet · low | sonnet · medium | |
| approver | sonnet · low | sonnet · medium | opus · medium | opus · medium |
| orchestrator | sonnet · medium (skill frontmatter) | | | |

Retries: each fix round's builder goes one effort step up (low → medium → high); on the
second retry a sonnet builder becomes opus.

## Other improvements (not cost)

- [x] **Base = the checked-out branch** (2026-10-27): jobs merge back where they started;
  `factory.base` still pins one. Detached HEAD is refused.
- [x] **Env files copied into worktrees** (`factory.copy`, default `.env*`, ignored files only).
- [x] **Plugin packaging** (`.claude-plugin/`), plus an agents drift check for git installs.
- [x] **`/factory pr`**, branch name template (`factory.branch`), spec kept in the repo (`factory.specdir`).
- [x] **`scripts/selftest.js`** (17 checks, no agents or network). Fixed on the way: stale
  backlog lock, crash on a corrupt quota.json, BOM in verdict files, `set` turning
  `note=123` into a number, DNS rebinding on the dashboard server.
- [ ] Shared `node_modules` across worktrees. Not done on purpose: a job's `npm install`
  would change the main checkout's packages, and parallel builds share `node_modules/.cache`.
  Revisit with pnpm (hard links) or a lockfile-keyed copy.
- [ ] Run one full end-to-end job on a throwaway repo after each big change (we have only one real run).
  Still untested end to end: a real `gh pr create`, Orca worktree creation.
- [ ] Old agents in job 001 lack the job-id prefix, so the dashboard can't count them; one-off
  backfill by matching descriptions ("Security review round 1") to job folders.
- [ ] Orca may rewrite the status line setting on update; `/factory hello` should check and offer to re-chain.
- [ ] Dashboard: a cost column per job and a "this week" total, from the same usage data.
