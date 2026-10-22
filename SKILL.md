---
name: factory
description: Run the software factory - spec, build, four parallel reviews and an approver, then the human tests and approves before anything merges. Every job gets its own worktree (through Orca when it is running, plain git otherwise), so several features can be built at once. Use when the user types /factory <feature>, /factory "<feature A>" "<feature B>", /factory next [n], /factory status, /factory test <job-id>, /factory approve <job-id>, /factory rework <job-id> <note>, /factory reject <job-id>, /factory resume [job-id], /factory dashboard, /factory morning|hi|hello (start-of-day briefing), or /factory goodbye|bye (end-of-day summary and backlog).
---

# Factory

You are the orchestrator. You run the loop below, spawn every agent, and are the
only writer of each job's `job.json`. You never write code, specs, reviews or
approval decisions yourself (the two exceptions are the skipped-review stubs and
the "rounds exhausted" decision described below). Agents do the work and each
writes exactly one file; you move jobs along and keep `job.json` current.

Maintained by DevJom (MIT, see LICENSE and README.md). Originally created by
ZazenCodes (github.com/zazencodes/zazencodes-season-3,
src/software-factory-claude-code); modified and improved by DevJom.

## Command routing

Look at the first word of the arguments. If it is one of `next`, `status`,
`test`, `approve`, `rework`, `reject`, `resume`, `dashboard`, `morning`, `hi`,
`hello`, `goodbye` or `bye`, run that command. Otherwise the whole argument is
a feature description (or several quoted ones). With no arguments, run
`/factory status`.

## The loop

```
feature → spec-writer → builder → [security, ux, ui, code] → WAIT FOR ALL
                           ▲                                      │
                           └──── any CHANGES: resume builder ◄────┤
                           ▲                                      ▼ all PASS
                           └── base moved + conflicts: sync ◄─ conflict check
                                                                  ▼
                                   approver ─ APPROVE → needs-human ("ready to test")
                                            └ ESCALATE → needs-human ("needs your decision")
                                                                  ▼
                                   human: /factory test → /factory approve → merge to base
```

Nothing merges without the human. The approver's verdict tells the human how
much attention the job needs; it never merges on its own.

| Step    | Agent (`subagent_type`)     | Writes                                     |
| ------- | --------------------------- | ------------------------------------------ |
| spec    | `factory-spec-writer`       | `spec.md`                                  |
| build   | `factory-builder`           | `build.md` + commits on the job branch     |
| review  | `factory-reviewer-security` | `round-N/review-security.md`               |
|         | `factory-reviewer-ux`       | `round-N/review-ux.md`                     |
|         | `factory-reviewer-ui`       | `round-N/review-ui.md`                     |
|         | `factory-reviewer-code`     | `round-N/review-code.md`                   |
| approve | `factory-approver`          | `decision.md`                              |

`MAX_RESUMES = 2`: after round 1 the builder can be resumed at most twice (for
review fixes or a base sync), so a job has at most 3 review rounds.
`MAX_ACTIVE = 3`: in one session, at most 3 jobs run at the same time; the rest
wait in a queue.

Every agent reads `AGENTS.md` (or `CLAUDE.md`) for the repo's setup, dev server,
validation commands and conventions. Nothing repo-specific lives in these files.

## Files

`<repo>` is the main checkout: the output of `git rev-parse --show-toplevel`
(on Windows this is `C:/Users/...`; use that form, with forward slashes, for
every path you pass to agents). `<name>` is its folder name.

```
<repo>/.factory/dashboard.html                 the visual board
<repo>/.factory/backlog.md                     queue for /factory next
<repo>/.factory/journal/<YYYY-MM-DD>.md       hello/goodbye log, one file per day
<repo>/.factory/merge.lock/                    exists only while a merge runs
<repo>/.factory/jobs/<job-id>/job.json         the job's state (only you write it)
<repo>/.factory/jobs/<job-id>/spec.md
<repo>/.factory/jobs/<job-id>/build.md
<repo>/.factory/jobs/<job-id>/rework-<k>.md    written by you, from /factory rework
<repo>/.factory/jobs/<job-id>/round-<N>/review-{security,ux,ui,code}.md
<repo>/.factory/jobs/<job-id>/decision.md
<worktree>                                     the job's checkout (see Worktrees)
```

`.factory/` is listed in git's local exclude file, so it never shows up in
`git status` and never lands in a commit.

### Setup (run at the start of every command)

1. `<repo>` must be a git repository with at least one commit. If not, stop and
   tell the user to run `git init` and make a first commit.
2. If `<repo>/.factory/` does not exist, create `.factory/jobs/`. Copy
   `assets/dashboard.html` from this skill's folder (the folder this SKILL.md is
   in, normally `~/.claude/skills/factory/`) to `.factory/dashboard.html` when
   it is missing or differs from the skill's copy (it is generated, never
   hand-edited, so this keeps every repo on the newest dashboard). If
   `.factory/backlog.md` is missing, create it:
   ```markdown
   # Backlog

   `/factory next` builds the first unchecked item and checks it off with its job id.

   ```
3. Make sure the file `$(git rev-parse --git-common-dir)/info/exclude` has a
   line `.factory/`. Append it if missing.
4. Base branch: `git config factory.base` if set; otherwise `main` if it exists;
   otherwise `master`; otherwise the current branch. Tell the user which one you
   picked the first time.
5. If the repo root has neither `AGENTS.md` nor `CLAUDE.md`, tell the user once:
   the agents will have to discover the setup and test commands themselves, and
   running `/init` first gives better results. Then continue.
6. Run `command -v agent-browser`. If it is missing, agents skip in-browser
   checks (see **Prompts**). Mention this once.
7. Detect Orca (see **Worktrees**) and tell the user once whether jobs will use
   Orca or plain git worktrees.

### job.json

```json
{ "id": "003-rate-limiting", "feature": "Rate limit the signup form",
  "branch": "factory/003-rate-limiting", "base": "main",
  "worktree": "C:/code/my-app-factory/003-rate-limiting",
  "orca": "", "dev_terminal": "",
  "stage": "review", "round": 2, "resumes": 1,
  "reviews": { "security": "CHANGES", "ux": "PASS", "ui": "pending", "code": "PASS" },
  "surface": "ui", "builder": "<agent id>", "overlaps": ["002-signup-copy"],
  "agents": [ { "id": "<agent id>", "role": "build", "round": 1 } ],
  "note": "", "started": "2026-10-21T10:00:00Z", "updated": "2026-10-21T10:12:00Z" }
```

- `stage` is one of `spec`, `build`, `review`, `approve`, `merged`,
  `needs-human`, `rejected`. Worktree setup and waiting in the queue count as
  `spec`.
- `branch` and `worktree` are whatever the worktree step produced (Orca may pick
  its own branch name and folder). Always use these fields, never assume
  `factory/<job-id>`.
- `orca` is the Orca worktree id (`<repoId>::<path>`) when Orca created the
  worktree, otherwise empty. `dev_terminal` is the Orca terminal handle or
  background task id of a dev server started by `/factory test`, otherwise empty.
- `round` is the current review round (0 until the first round starts).
- `reviews` holds the current round only: `pending`, `PASS` or `CHANGES`.
- `surface` is `ui` or `none`, taken from spec.md (empty until then).
- `builder` is the agent id (or name) of the job's builder, for resuming it.
- `note` is a one-line human-readable reason for the current state (queued,
  waiting, ready to test, blocked, conflict), shown on the dashboard.
- Rewrite the whole file on every change and update `updated`. When `orca` is
  set, also update the Orca card (see **Orca cards**).

### Tracking agents

Every Agent call you make for a job must have a `description` that starts with
the job id and a colon, for example `004-dark-mode: security review round 2` or
`004-dark-mode: build round 1`. Right after each spawn, append
`{ "id": "<agent id>", "role": "<spec|build|security|ux|ui|code|approve>", "round": N }`
to the job's `agents` list in `job.json`. The dashboard server uses both to show
which agents ran for each job and how many tokens they used.

### Prompts

Every agent prompt starts with:
`Job folder: <repo>/.factory/jobs/<job-id>/. Worktree: <worktree>. Branch: <branch>. Base: <base>.`
Below, `<paths>` stands for that sentence.

Agents that open pages also get a port. With `n` the job number (`003` → 3),
the builder gets `5100 + 10n`, `factory-reviewer-ux` gets `5101 + 10n` and
`factory-reviewer-ui` gets `5102 + 10n`, appended as ` Port: <port>.` If
`agent-browser` is missing, append ` Browser: none.` instead. The human's dev
server from `/factory test` uses `5103 + 10n`.

## Worktrees

### Detecting Orca

Pick the Orca executable: the `ORCA_CLI_COMMAND` environment variable if set;
otherwise `orca-ide` on Linux and `orca` everywhere else. Never run bare `orca`
on Linux (it can start the GNOME screen reader). Then run
`<orca> repo list --json`.

- If the command is missing, fails, or says Orca is not running: use **git
  mode**. Do not start Orca.
- If it works: use **Orca mode**. Find the repo whose path is `<repo>` (on
  Windows Orca prints `C:\...` and git prints `C:/...`: compare with slashes
  normalised and case ignored); if it is
  not registered, run `<orca> repo add --path <repo> --json` and tell the user.
  Keep its repo id.

### Orca mode

Create the worktree with:

```bash
<orca> worktree create --repo id:<repoId> --name factory-<job-id> --no-parent --base-branch <base> --comment "<job-id>: writing spec" --json
```

Save the result's worktree `id` in `orca` and its path in `worktree` (the id is
`<repoId>::<path>`). Read the branch with
`git -C <worktree> branch --show-current` and save it in `branch`. If the repo
has no `orca.yaml` setup hook, run the AGENTS.md fresh-checkout setup in the
worktree yourself. If `worktree create` fails, fall back to git mode for this
job and say why.

### Git mode

```bash
git worktree add -b factory/<job-id> <parent of repo>/<name>-factory/<job-id> <base>
```

`branch` is `factory/<job-id>` and `worktree` is that folder. Then run the
AGENTS.md fresh-checkout setup in the worktree (for example installing
dependencies).

### Orca cards

When `orca` is set, after each job.json change run
`<orca> worktree set --worktree id:<orca> --comment "<short status>" --json`
with a line like `round 2: security CHANGES, fixing` or `ready to test`.
Also set `--workspace-status in-progress` while the job is in spec, build,
review or approve, and `--workspace-status in-review --unread` when it reaches
needs-human. A failed card update is not an error; carry on.

### Removing a worktree

- Orca mode: `<orca> worktree rm --worktree id:<orca> --json` (never `--force`).
  Orca also deletes the branch if it is merged and keeps it otherwise.
- Git mode: `git worktree remove <worktree>` (never `--force`).

If removal fails (often because a dev server or editor still has files open on
Windows, or there are uncommitted changes), report what it printed and tell the
user to close whatever runs from that folder; never force it.

## Running several features at once

Each job has its own branch, its own worktree folder, its own `job.json`, its
own dev-server ports and its own browser sessions, so jobs never step on each
other while they are being built and reviewed. They only meet at the end, when
they merge into the base branch, and that is handled by the conflict check, the
sync step and the merge lock.

**One session, many jobs.** `/factory "feature A" "feature B" "feature C"` or
`/factory next 3`. You orchestrate all of them:

- Create every job (steps 1 and 2 of **/factory <feature>**) up front. Start up to
  `MAX_ACTIVE` of them; the rest stay at `stage: "spec"` with `note: "queued"`
  and start as active jobs reach needs-human or rejected.
- Spawn agents in the background. Whenever an agent finishes, advance only the
  job it belongs to, then wait for the next one. Never make one job wait for
  another, except for **Overlap holds** and merges.
- Spawn agents for different jobs in the same message when they are ready at the
  same time.
- Prefix every status line with the job id.

**Several sessions.** The user can also open several Claude sessions in the same
repo and run `/factory <feature>` or `/factory next` in each. Job numbers and
backlog items are claimed atomically (see below), each session writes only its
own jobs' `job.json`, and each session orchestrates only the jobs it started or
was handed.

### Overlap check and holds

After a spec is written, compare its `## Files likely touched` list with the
specs of every other job in `spec`, `build`, `review`, `approve` or
`needs-human`. Record any job ids that share a path in `overlaps` and tell the
user in one line.

In one-session mode, if a job shares a path with an earlier job that you are
also running, hold it: keep it at `stage: "spec"` with
`note: "waiting for <earlier job-id> (same files)"` and start its build only
after the earlier job is merged or rejected. Then update its worktree before
building: `git -C <worktree> merge <base>` (it has no commits yet, so this
fast-forwards). Jobs started from other sessions are not held; the conflict
check handles them.

## /factory <feature>

1. **Create the job.** Pick the next 3-digit number after the highest numbered
   folder in `.factory/jobs/` (`001` if none) and a 2–4 word kebab-case slug of
   the feature: `004-blog-reading-time`. Claim it with
   `mkdir .factory/jobs/<job-id>` (no `-p`). If that fails because another
   session took the number, pick the next number and try again. Write
   `job.json` with `stage: "spec"`, `round: 0`, `resumes: 0`, all reviews
   `pending`.
2. **Worktree.** Create it in Orca mode or git mode (see **Worktrees**) and save
   `branch`, `worktree` and `orca`. If setup fails, go to **Needs human** with
   the error in `note`.
3. **Spec.** Spawn `factory-spec-writer` with `<paths> Feature: <feature, verbatim>`.
   When it finishes, check that `spec.md` exists. Read its `Surface:` line into
   `surface`. Run the **Overlap check**.
4. **Build.** Set `stage: "build"`. Spawn `factory-builder` (give it the name
   `builder-<job-id>` if your Agent tool accepts a name) with
   `<paths> Build round 1. Port: <port>.` Save its agent id/name in `builder`.
   When it finishes, go to **Build check**.

### Build check

Read the first line of `build.md`.

- `STATUS: READY`: start the next review round.
- `STATUS: BLOCKED`: go to **Needs human**.

### Review round N

1. Set `stage: "review"`, `round: N`, all four reviews `pending`. Create
   `round-<N>/`.
2. **Skip what doesn't apply.** If `surface` is `none` AND
   `git diff --name-only <base>...<branch>` lists no front-end files
   (`.html .css .scss .sass .less .vue .svelte .jsx .tsx .astro`, templates,
   or anything under a `components/`, `pages/`, `views/` or `styles/` folder),
   write `review-ux.md` and `review-ui.md` yourself as:
   ```markdown
   VERDICT: PASS

   ## Findings
   None.

   ## Notes
   Skipped by the orchestrator: the spec says Surface: none and the diff has no front-end files.
   ```
   and set those two reviews to `PASS`. Otherwise run all four.
3. Spawn the remaining reviewers **in one message**, so they run in parallel,
   each with `<paths> Review round N.` plus its port (or `Browser: none`) for
   the UX and UI reviewers.
4. **WAIT FOR ALL.** Each time a reviewer finishes, read the first line of its
   file and write that verdict to `job.json` straight away. The round is done
   only when all four `review-*.md` files exist. Never resume the builder
   mid-round. If a reviewer finishes without writing its file, or its first line
   is not `VERDICT: PASS` or `VERDICT: CHANGES`, go to **Needs human** with that
   in `note`.
5. Decide:
   - **All PASS**: go to **Conflict check**.
   - **Any CHANGES, `resumes < 2`**: increment `resumes`, set `stage: "build"`,
     and resume the builder (see **Resuming the builder**) with:
     `Round N reviews are in <job folder>/round-<N>/. Address every review with VERDICT: CHANGES, commit, and update build.md for round N+1.`
     Then go to **Build check**.
   - **Any CHANGES, no resumes left**: write `decision.md` yourself:
     `ESCALATE`, a blank line, then
     `Review rounds exhausted. Outstanding CHANGES in round-<N>/ from: <reviewers>.`
     Go to **Needs human**.

### Resuming the builder

Send the message with `SendMessage` to the id/name in `builder`, so it keeps its
context. If that fails (the agent is gone, or this is a new session), spawn a
fresh `factory-builder` with `<paths> Port: <port>.` followed by the same
message and `Read build.md and every round folder first for the history.`
Save the new id in `builder`.

### Conflict check

Run `git merge-tree --write-tree <base> <branch>` in `<repo>`.

- Exit code 0 (no conflicts): go to **Approve**.
- Conflicts: the base branch moved (often because another job merged) and now
  clashes with this branch. If `resumes < 2`: increment `resumes`, set
  `stage: "build"`, `note: "syncing with <base>"`, resume the builder with:
  `<base> has moved and conflicts with your branch. In the worktree run git merge <base>, resolve the conflicts so both the base changes and your feature work, re-run validation, commit the merge, and update build.md for round N+1.`
  Then **Build check** and a new review round (the code changed, so it must be
  reviewed again). If no resumes are left, go to **Needs human** with
  `note: "conflicts with <base>"`.

### Approve

Set `stage: "approve"`. Spawn `factory-approver` with `<paths> Final round: N.`
When it finishes, read the first line of `decision.md`:

- `APPROVE`: go to **Needs human** with `note: "approved by the factory - ready for you to test"`.
- `ESCALATE`: go to **Needs human** with `note: "needs your decision - see decision.md"`.

The factory never merges on its own. The human merges with `/factory approve`.

### Needs human

Set `stage: "needs-human"` and the `note`. The branch and worktree stay so the
human can test and inspect them. Tell the user which job is waiting, the
worktree path, and quote the `## Why` (and `## For the human`, if present) of
`decision.md`, or the `## Blocked` section of `build.md`, or the note. Then
show the next steps:

```
/factory test <job-id>                 run it and try it yourself
/factory approve <job-id>              merge it into <base>
/factory rework <job-id> "<feedback>"  send it back to the builder
/factory reject <job-id>               drop it
```

Release any job held for this one only once it is merged or rejected.

### Merge

Run only from `/factory approve`. The merge happens in the main checkout and
only one merge runs at a time.

1. **Stop the dev server** if `dev_terminal` is set: in Orca mode
   `<orca> terminal close --terminal <dev_terminal> --json`; otherwise stop that
   background task. Clear `dev_terminal`.
2. **Lock.** `mkdir <repo>/.factory/merge.lock`. If it already exists and is
   older than 10 minutes, it is stale: remove it and try once more. If a live
   merge holds it, tell the user to retry in a moment and stop.
3. **Main checkout ready?** In `<repo>`: `git branch --show-current` must print
   `<base>` and `git status --porcelain` must print nothing. If not, release the
   lock and tell the user to switch to `<base>` and commit or stash first.
4. **Worktree clean?** `git -C <worktree> status --porcelain` must print
   nothing. If the human edited files while testing, release the lock and ask
   them to commit those edits in the worktree (they become part of the feature)
   or discard them.
5. **Conflicts?** Repeat the merge-tree check (another job may have just
   merged). If it conflicts, release the lock and tell the user to run
   `/factory rework <job-id> "merge <base> and resolve the conflicts"`.
6. **Merge.**
   ```bash
   git merge --no-ff <branch> -m "Merge <branch>: <feature, shortened>"
   ```
   If it fails, run `git merge --abort` (if a merge is in progress), release the
   lock, and tell the user why.
7. Release the lock (`rmdir <repo>/.factory/merge.lock`). Remove the worktree
   (see **Removing a worktree**), then `git branch -d <branch>` if the branch
   still exists. Set `stage: "merged"`, `note: ""`. If removal fails, the job is
   still merged: say what failed and how to finish the cleanup.
8. Release any job held for this one.

Never push. Tell the user the merge is local and they push when ready.

## /factory next [n]

Read `.factory/backlog.md` and take the first `- [ ]` item. Claim it with one
Edit that replaces its exact line with `- [x] <item> → claimed`. If the Edit
fails because the line changed, another session claimed it: re-read and try the
next `- [ ]` item. Once the job has an id, replace `claimed` with the job id.
With `n` > 1, claim `n` items (or as many as are left) and run them as one
multi-job session. If nothing is left, say so and stop.

## /factory "<feature A>" "<feature B>" ...

More than one quoted feature: run them as one multi-job session (see
**Running several features at once**).

## /factory status

Print a table of every job in `.factory/jobs/`: id, stage, round, reviews,
note, worktree. List jobs in `needs-human` first, with the commands to finish
each one.

## /factory test <job-id>

Helps the human try a job before approving it. The job must have a worktree.

1. Find the dev-server command in AGENTS.md/CLAUDE.md or the spec's
   `## Commands` section, and run it on port `5103 + 10n` (pass the port the way
   the project's tooling expects, for example `-- --port <port>` for Vite or a
   `PORT` env var). If the project has no dev server (a library or CLI), skip
   this and give the commands to run its tests or try the CLI in the worktree.
2. Orca mode: `<orca> terminal create --worktree id:<orca> --title "factory dev server" --command "<dev command>" --json`
   and save the handle in `dev_terminal`. Git mode: start it as a background
   task with its working directory set to the worktree, and save the task id.
3. Tell the user:
   - the URL to open (`http://localhost:<port>`), and that in Orca they can also
     open it in the worktree's built-in browser;
   - the worktree folder, to open in their editor;
   - `git diff <base>...<branch> --stat` and the acceptance criteria from
     `spec.md`, as a checklist to try;
   - that edits they make in the worktree must be committed there (or
     discarded) before `/factory approve`.

## /factory approve <job-id>

The job must be in `needs-human`. If `decision.md` starts with `ESCALATE` or
`build.md` is BLOCKED, confirm with the user that they want to merge anyway.
Then run **Merge**.

## /factory rework <job-id> <note>

The job must be in `needs-human`.

1. Write the note, verbatim, to `rework-<k>.md` (`k` = next unused number).
2. If the worktree is gone, recreate it from the branch:
   `git worktree add <worktree> <branch>` (Orca shows it if the repo shows
   external worktrees; clear `orca` in that case).
3. Set `stage: "build"`, `resumes: 0`, `note: ""`.
4. Spawn a fresh `factory-builder` with
   `<paths> Rework: read rework-<k>.md and address it, then update build.md for round N+1. Port: <port>.`
   (`N` = the job's last round.) Save its id in `builder`.
5. Continue from **Build check**, exactly like a new job.

## /factory reject <job-id>

The job must be in `needs-human`. Ask the user to confirm first. Stop the dev
server as in **Merge** step 1, remove the worktree (see **Removing a
worktree**), and set `stage: "rejected"`. The branch is kept (Orca and
`git worktree remove` never delete an unmerged branch); tell the user they can
delete it with `git branch -D <branch>`. Release any job held for this one.

## /factory resume [job-id]

Picks up a job whose orchestrator session ended mid-run (closed window, crash,
lost connection). Without a job id, list the jobs in `spec`, `build`, `review`
or `approve` and ask which to resume (or resume all of them as a multi-job
session if the user says so). Make sure no other session is still running the
job: if its `updated` time is within the last 10 minutes, ask the user first.
Then continue from the job's stage:

- **spec**: if the worktree is missing, create it (step 2). If `spec.md`
  exists, go to step 4 (Build); otherwise run step 3 (Spec).
- **build**: spawn a fresh `factory-builder` with
  `<paths> Continue: the previous builder was interrupted. Read build.md and every round folder, finish the work for round <round + 1>, commit, and update build.md. Port: <port>.`
  Save its id in `builder`, then go to **Build check**.
- **review**: spawn only the reviewers whose file is missing from `round-<N>/`
  (in parallel), then continue from step 4 of **Review round N**.
- **approve**: if `decision.md` exists, act on its first line as in
  **Approve**; otherwise spawn the approver.
- **needs-human**, **merged**, **rejected**: nothing to resume; say what the
  job is waiting for.

## /factory morning | hi | hello

A start-of-day briefing. It only reads and suggests; it starts nothing on its
own, because jobs cost money.

1. Run Setup. Read the newest file in `.factory/journal/` (the last goodbye),
   if any. "Since last time" means since that file's last entry; with no
   journal, since 24 hours ago.
2. Gather:
   - **Done since last time**: jobs whose stage became `merged` or `rejected`
     (by `updated`), and `git log --oneline --since=<then> <base>` (this also
     shows the user's own commits).
   - **Waiting for you**: jobs in `needs-human`, "ready to test" first, then
     "your call", each with its note.
   - **Interrupted**: jobs in `spec`, `build`, `review` or `approve` whose
     `updated` is older than 10 minutes. No session is driving them; they need
     `/factory resume`.
   - **Backlog**: the unchecked `- [ ]` items in `.factory/backlog.md`.
   - **Repo health**: is the main checkout on `<base>` and clean; unpushed
     commits (`git log --oneline @{u}..<base>`, if there is an upstream); job
     worktrees whose job is `merged` or `rejected` but whose folder still
     exists (cleanup that failed).
   - **Last time's plan**: the `## Next time` list from the journal.
3. Reply with a short briefing:
   ```
   Good morning. Since <when>:
   Done:        <merged/rejected jobs, notable commits>
   Waiting:     <needs-human jobs + the command for each>
   Interrupted: <jobs + /factory resume>
   Backlog:     <n items, first 3 listed>
   Heads-up:    <unpushed commits, dirty checkout, leftover folders>

   Suggested plan:
   1. /factory test 004-dark-mode   (ready to test since yesterday)
   2. /factory resume 005-csv-export
   3. /factory next 2
   ```
   Order the plan: things waiting on the human first (they unblock merges),
   then interrupted jobs, then new work from the backlog, then last time's
   plan. Leave out empty sections. Then ask what to start.
4. Append `### <HH:MM> hello` to today's journal file (see **Journal**) with
   one line: how many jobs were waiting, interrupted and in the backlog.

## /factory goodbye | bye [notes]

End-of-day wrap-up: what got done, what is open, and what to do next time.

1. Run Setup. "Today" means since the earliest entry in today's journal file,
   or the start of the day if there is none.
2. **Jobs this session is still running.** If any job you are orchestrating is
   in `spec`, `build`, `review` or `approve`, tell the user they will stop when
   this session closes, and ask: wait for them to reach needs-human, or stop
   here and pick them up later with `/factory resume`. Don't spawn new agents
   after the user says goodbye.
3. **Dev servers.** Stop every dev server `/factory test` started
   (`dev_terminal`), and clear the field.
4. **Backlog suggestions.** Collect follow-up ideas from today's jobs: the
   `## Notes` of review files, the approver's `## Why` and `## For the human`,
   the spec's `## Out of scope`, and rejected jobs whose idea the user may want
   to retry differently. Also take any `[notes]` the user typed after the
   command. Turn each into a one-line backlog item. Show the list and ask which
   to add (all, some, none). Append the chosen ones as `- [ ] <item>` to
   `.factory/backlog.md`. Never add items without asking.
5. **Write the summary** to today's journal file (see **Journal**):
   ```markdown
   ### <HH:MM> goodbye

   ## Done
   - 004-dark-mode: merged (round 1, approved)
   - 006-confetti: rejected (not needed)
   - Other commits on <base>: <git log --oneline since today>

   ## Waiting for you
   - 005-csv-export: ready to test → /factory test 005-csv-export

   ## In progress / interrupted
   - 007-pagination: stopped at review round 2 → /factory resume 007-pagination

   ## Added to backlog
   - Rate limit the CSV export endpoint (from security review notes)

   ## Next time
   1. /factory test 005-csv-export
   2. /factory resume 007-pagination
   3. /factory next
   ```
   Leave out empty sections.
6. Reply with the same summary, plus a reminder of anything that only the
   human can do: unpushed commits (`git push`), a dirty main checkout, leftover
   worktree folders. End with `See you next time - start with /factory hello.`

### Journal

`<repo>/.factory/journal/<YYYY-MM-DD>.md`, one file per day, using the local
date. Create the folder and the file (with a `# <YYYY-MM-DD>` heading) if they
don't exist. Always append, never rewrite earlier entries: several sessions may
say hello and goodbye on the same day.

## /factory dashboard

Run Setup, then start the dashboard server in the background:
`node <skill folder>/scripts/serve.js <repo>/.factory 8765`
(pick another port if 8765 is taken). It serves the board plus the plan's
remaining quota and each job's agents and token counts. If `node` is missing,
fall back to `python -m http.server 8765 --bind 127.0.0.1 --directory <repo>/.factory`
(or `python3`); the board works but without quota and tokens.

Tell the user to open `http://127.0.0.1:8765/dashboard.html`. It polls every two
seconds, so they can leave it open while jobs run. If the header says
`quota: n/a`, the factory status line has not run yet: it needs the
`statusLine` setting in `~/.claude/settings.json` to run
`node "<skill folder>/scripts/statusline.js"`, and a Claude Code terminal
session on a Pro or Max plan. If another tool already owns the status line (Orca
installs `claude-statusline.cmd`), keep it by chaining:
`node "<skill folder>/scripts/statusline.js" --then "<existing command>"`.
If a tool later overwrites the setting, offer to re-chain it; never drop the
other tool's command.

## Safety

Never push. Never force anything (`--force`, `-D`, `reset --hard`). Never
rebase or rewrite history. Never `git add -A`. Never touch the main checkout
except in **Merge**. Delete a branch only with `git branch -d` after a
successful merge. Never start Orca if it isn't running.

## Reporting

One short line per transition, for example
`003-rate-limiting: round 2, security CHANGES, ux/ui/code PASS → resuming builder`.
When a job stops, say whether it is ready to test or needs a decision, and why.
In a multi-job session, finish with a table of every job's stage.
