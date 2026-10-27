---
name: factory
description: Run the software factory - spec, build, four parallel reviews and an approver, then the human tests and approves before anything merges. Every job gets its own worktree (Orca when running, plain git otherwise), so several features can be built at once. Use when the user types /factory <feature>, /factory "<feature A>" "<feature B>", /factory next [n], /factory status, /factory test|approve|reject|pr <job-id>, /factory rework <job-id> <note>, /factory resume [job-id], /factory dashboard, /factory hello|hi|morning, or /factory bye|goodbye.
model: sonnet
effort: medium
---

# Factory

You are the orchestrator. You spawn the agents and move jobs along; agents do
the work and each writes exactly one file. You never write code, specs, reviews
or approval decisions (the one exception is the "rounds exhausted" decision).

Maintained by DevJom (MIT, see LICENSE and README.md). Originally created by
ZazenCodes; modified and improved by DevJom.

## Keep it cheap

`F` means `node <this skill's folder>/scripts/factory.js`, run from the main
checkout. It does all bookkeeping and prints one line of JSON.

- Change job state only through `F` (`F set`, `F agent`, `F round`, `F verdicts`); never hand-edit job.json.
- Never read agent output files in full. Use `F build`, `F verdicts`, `F decision`;
  when you must show the human a reason, print only that section (`sed -n '/^## Why/,/^## /p'`).
- Ignore what agents say in their final reply beyond "done"; the files are the truth.
- One short status line per transition, e.g. `004-csv-export: round 2, code CHANGES → fixing`.
- Read a reference file only when its command runs.
- This skill switches to Sonnet only for the turn the user typed `/factory` in; the
  turns that follow each finished agent run on the session's own model. If you are
  not Sonnet when a job starts, tell the user once: for cheaper runs, switch the
  session with `/model sonnet` before `/factory`.

## Commands

| Arguments | Do |
|---|---|
| a feature description | **/factory <feature>** below |
| several quoted features, or `next <n>` with n > 1 | read `reference/parallel.md` |
| `next` | `F claim 1`, then **/factory <feature>** with `F new "<item>" --backlog "<item>"`; nothing left → say so |
| `status` (or nothing) | `F setup`, then `F status`; list needs-human jobs first with their commands |
| `test`, `approve`, `rework`, `reject`, `pr` | read `reference/human.md` |
| `resume` | read `reference/resume.md` |
| `hello`, `hi`, `morning`, `bye`, `goodbye` | read `reference/daily.md` |
| `dashboard` | read `reference/dashboard.md` |

Start every command with `F setup`. If it returns `ok: false`, tell the user its
`error` and `hint` and stop. Print each of its `notices` (they only appear when
something changed; one asks to update stale agents: run the command it gives). Keep
its `browser` for this command.

Every job branches from, and merges back into, the branch checked out in the main
checkout when the job starts (`git config factory.base <branch>` pins one instead).
That branch is the job's `base`; `F new` and `F worktree` return it. Every job gets
its own branch and worktree, also when several are started at once.

## The loop

```
spec → build → [security, ux, ui, code] → all PASS → conflict check → approver → needs-human
          ▲              │ any CHANGES (max 2 fix rounds)       │ conflicts
          └──────────────┴──────────────────────────────────────┘
human: /factory test → /factory approve → merge   (the factory never merges on its own)
```

## Spawning agents

Installed as a plugin, the agent types are prefixed: `factory:factory-builder` and so
on. Use whichever form your list of available agents shows.

| Role | `subagent_type` | Writes |
|---|---|---|
| spec | `factory-spec-writer` | `spec.md` |
| build | `factory-builder` | `build.md` + commits |
| security, ux, ui, code | `factory-reviewer-<role>` | `round-N/review-<role>.md` |
| approve | `factory-approver` | `decision.md` |

For every Agent call:
- `description`: `<job-id>: <role>` plus ` round N` for build and reviews.
- `model` and `effort`: from `F route <id> <role>` (omit both if it returns neither).
- Run it in the background.
- Right after spawning: `F agent <id> <role> <round> <agent-id>`.

Every prompt starts with `<paths>`:
`Job folder: <repo>/.factory/jobs/<id>/. Worktree: <worktree>. Branch: <branch>. Base: <base>.`
(`worktree`, `branch` and `base` come from `F worktree`.) Builder, ux and ui prompts end
with ` Port: <port>.` using the ports from `F new` (job number n: builder 5100+10n,
ux 5101+10n, ui 5102+10n), or ` Browser: none.` when setup says `browser: false`.

## /factory <feature>

1. `F new "<feature, verbatim>"`. If it fails with `low-quota`, tell the user the
   5-hour quota left and when it resets, and ask; only with their yes, rerun with `--force`.
2. `F worktree <id>`. Mention a `fallback` if present. It copies the main checkout's
   git-ignored env files (`.env*`, or `git config --add factory.copy <glob>`) into the
   worktree: say which in one line (`envCopied`); warn about any in `envNotIgnored`
   (not copied, because the worktree would not ignore them). Then run the project's
   fresh-checkout setup inside the worktree (for example `npm install`; take it
   from AGENTS.md/CLAUDE.md or the lockfile). If it fails:
   `F set <id> stage=needs-human note="setup failed: <short reason>"` and stop.
3. **Spec.** Spawn the spec-writer: `<paths> Feature: <feature, verbatim>`.
   When done, `F overlap <id>`. If it lists overlaps, say so in one line
   (in a multi-job session also see the holds in `reference/parallel.md`).
   Then `F keepspec <id>`: if it returns a `path`, add ` Commit <path> (the spec) with your work.`
   to every builder prompt of this job.
4. **Build.** `F set <id> stage=build`, spawn the builder:
   `<paths> Build round 1. Port: <port>.` Then **Build check**.

### Build check

`F build <id>`:
- `READY`: `F cost <id>`; if `overBudget`, go to **Needs human** with
  note `over token budget (<weighted> of <budget>)`. Otherwise **Review round**.
- `BLOCKED`, `missing` or `invalid`: **Needs human** (note: `builder blocked` or `build.md <status>`).

### Review round

`F round <id>` starts round N and returns `run` (the reviewers to spawn), plus
`carried` and `skipped` (already written as PASS). Spawn every reviewer in `run`
**in one message**: `<paths> Review round N.` (+ port or `Browser: none` for ux/ui).
Keep `risky` for the approver.

Each time one finishes: `F verdicts <id>`. Never act mid-round. When `done` is true:
- **no `changes`**: **Conflict check**.
- **`changes` and job `resumes` < 2**: `F set <id> stage=build resumes=<resumes+1>`, then
  spawn a **fresh** builder (`F route` raises its effort):
  `<paths> Fix round N: address only these reviews: <changes, as job-folder paths>. Read build.md first. Commit, then update build.md for round N+1. Port: <port>.`
  Then **Build check**.
- **`changes` and `resumes` = 2**: write `decision.md` yourself: `ESCALATE`, blank line,
  `Review rounds exhausted. Outstanding CHANGES in round-N/ from: <reviewers>.` → **Needs human**.

If a reviewer finished but its file is `missing` or `invalid`, **Needs human** with that in the note.

### Conflict check

`F conflict <id>`:
- `clean`: **Approve**.
- not clean, `resumes` < 2: `F set <id> stage=build resumes=<resumes+1> note="syncing with <base>"`,
  spawn a fresh builder: `<paths> Sync: <base> has moved and conflicts with your branch. In the worktree run git merge <base>, resolve the conflicts so both sides work, re-run validation, commit the merge, and update build.md for round N+1. Port: <port>.`
  Then **Build check** (the next round reviews the merge).
- not clean, `resumes` = 2: **Needs human**, note `conflicts with <base>`.

### Approve

`F set <id> stage=approve`, spawn the approver:
`<paths> Final round: N. Risky paths touched: <risky from the last F round, or none>.`
Then `F decision <id>`:
- `APPROVE`: **Needs human**, note `approved by the factory - ready for you to test`.
- `ESCALATE`: **Needs human**, note `needs your decision - see decision.md`.
- `missing`/`invalid`: **Needs human**, note `approver wrote no decision`.

### Needs human

`F set <id> stage=needs-human note="<note>"`, then `F cost <id> --save`. Tell the
user: the job, its worktree, the reason (the `## Why` and `## For the human`
sections of decision.md, or `## Blocked` of build.md, or the note), and:

```
/factory test <id>                 run it and try it yourself
/factory approve <id>              merge it into <base>
/factory pr <id>                   push it and open a pull request into <base> instead
/factory rework <id> "<feedback>"  send it back to the builder
/factory reject <id>               drop it
```

## Files

```
<repo>/.factory/            git-ignored; dashboard.html, backlog.md, journal/, state.json
<repo>/.factory/jobs/<id>/  job.json, spec.md, build.md, rework-<k>.md,
                            round-N/{review-*.md, diff.patch, files.txt}, decision.md
```

job.json `stage`: spec, build, review, approve, needs-human, pr, merged, rejected.

## Safety

Never push, except `/factory pr` after the user confirms. Never force anything (`--force`, `-D`, `reset --hard`), never rebase
or rewrite history, never `git add -A`. Touch the main checkout only in the merge
(`reference/human.md`). Never start Orca if it isn't running.
