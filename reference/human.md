# Human commands: test, approve, pr, rework, reject

`F` = `node <skill folder>/scripts/factory.js`. `<orca>` = the `exe` in
`<repo>/.factory/state.json` (only used when the job's `orca` field is set).
Read a job's fields with `node -p "JSON.stringify(require('./.factory/jobs/<id>/job.json'))"`
(fields: worktree, branch, base, orca, dev_terminal, stage, round).

## /factory test <id>

The job must have a worktree.

1. Find the dev-server command in AGENTS.md/CLAUDE.md or the spec's `## Commands`
   section. Port: 5103 + 10n (n = job number). Pass it the way the tooling expects
   (`-- --port <port>` for Vite/Next, a `PORT` env var, ...). No dev server (a library
   or CLI)? Give the commands to run its tests or try it in the worktree instead.
2. Orca job: `<orca> terminal create --worktree id:<orca> --title "factory dev server" --command "<dev command>" --json`.
   Otherwise start it as a background task with its working directory set to the worktree.
   Save the handle or task id: `F set <id> dev_terminal=<handle>`.
3. Tell the user: the URL `http://localhost:<port>` (in Orca they can also use the
   worktree's built-in browser), the worktree folder, `git diff <base>...<branch> --stat`,
   the acceptance criteria from spec.md as a checklist, and that edits they make in
   the worktree must be committed there (or discarded) before approving.

## /factory approve <id>

Job in `pr` (its PR was opened with `/factory pr`): `gh pr view <pr> --json state -q .state`
must print `MERGED`; otherwise say the PR is still open and stop. If merged, stop the
dev server (step 1), remove the worktree (below), `git branch -d <branch>` (keep it if
that refuses and say so), `F set <id> stage=merged note=""`. Remind the user to pull
`<base>`. Nothing is merged locally.

Otherwise the job must be in `needs-human`. If `F decision <id>` is `ESCALATE` or `F build <id>`
is `BLOCKED`, confirm with the user first. Then merge, one merge at a time:

1. **Dev server.** If `dev_terminal` is set: `<orca> terminal close --terminal <handle> --json`
   (Orca) or stop that background task. `F set <id> dev_terminal=""`.
2. **Lock.** `mkdir <repo>/.factory/merge.lock`. Exists and older than 10 minutes:
   stale, remove it and retry once. Otherwise tell the user to retry in a moment; stop.
3. **Main checkout ready?** `git branch --show-current` must be `<base>` and
   `git status --porcelain` empty. If not: release the lock, tell the user to switch
   to `<base>` and commit or stash first.
4. **Worktree clean?** `git -C <worktree> status --porcelain` empty. If not: release
   the lock, ask the user to commit those edits in the worktree (they become part of
   the feature) or discard them.
5. **Conflicts?** `F conflict <id>`. Not clean: release the lock, suggest
   `/factory rework <id> "merge <base> and resolve the conflicts"`.
6. **Merge.** `git merge --no-ff <branch> -m "Merge <branch>: <feature, shortened>"`.
   On failure: `git merge --abort` (if a merge is in progress), release the lock, say why.
7. `rmdir <repo>/.factory/merge.lock`. Remove the worktree (below), then
   `git branch -d <branch>` if it still exists. `F set <id> stage=merged note=""`.
   If the removal fails the job is still merged: say what failed.
8. In a multi-job session, release jobs held for this one (`reference/parallel.md`).

Never push. Tell the user the merge is local and they push when ready.

## /factory pr <id>

For teams that merge through pull requests and CI instead of a local merge. The job
must be in `needs-human` (or `pr`, to push later commits to the same PR). If
`F decision <id>` is `ESCALATE` or `F build <id>` is `BLOCKED`, say so. Always ask
the user to confirm before pushing: name the branch, the remote and the base.

1. Stop the dev server (approve step 1).
2. `F pr <id>`: pushes the branch (`git config factory.remote`, default `origin`) and
   runs `gh pr create` into the job's base, with the spec title, the build summary,
   the acceptance criteria and the factory decision as the body. A job that already
   has a PR only gets the push.
3. Tell the user the PR URL. The worktree stays, so `/factory rework <id> "<review
   comments>"` and another `/factory pr <id>` update the same PR. Once it is merged on
   the remote, `/factory approve <id>` cleans up.

Errors: `push-failed` or `gh-pr-failed` → show `detail` and `hint`. A missing base
branch on the remote is the usual cause: the user pushes it first.

## /factory rework <id> <note>

The job must be in `needs-human` or `pr`.

1. Write the note verbatim to `<repo>/.factory/jobs/<id>/rework-<k>.md` (next unused k).
2. `F worktree <id>`: re-creates the worktree if it is gone and copies the env files again.
3. `F set <id> stage=build resumes=0 note=""`.
4. Spawn a fresh builder (as in SKILL.md, `F route <id> build`):
   `<paths> Rework: read rework-<k>.md and build.md, address the note, commit, then update build.md for round <round+1>. Port: <port>.`
5. Continue from **Build check** in SKILL.md.

## /factory reject <id>

The job must be in `needs-human` or `pr` (closing the PR is up to the user). Ask the user to confirm. Stop the dev server as
in approve step 1, remove the worktree (below), `F set <id> stage=rejected`. The
branch is kept; tell the user `git branch -D <branch>` deletes it.

## Removing a worktree

- Orca job: `<orca> worktree rm --worktree id:<orca> --json` (never `--force`; Orca
  deletes the branch only if it is merged).
- Otherwise: `git worktree remove <worktree>` (never `--force`).

If it fails (on Windows usually a dev server or editor still has files open, or
uncommitted changes), report what it printed and tell the user what to close.
