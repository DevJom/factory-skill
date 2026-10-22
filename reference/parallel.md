# Several features at once

Each job has its own branch, worktree, job.json, ports and browser sessions, so
jobs never touch each other while they are built and reviewed. They meet only
when merging, which the conflict check, the sync step and the merge lock handle.

## One session, many jobs

`/factory "feature A" "feature B" ...` or `/factory next <n>` (use `F claim <n>`,
then `F new "<item>" --backlog "<item>"` for each item).

- Create every job up front (`F new`, `F worktree`). Run at most **3 at a time**;
  for the rest, `F set <id> note=queued` and start them as active jobs reach
  needs-human or rejected.
- Spawn agents in the background. Whenever one finishes, advance only its job,
  then wait for the next. Spawn agents of different jobs in the same message
  when they are ready together.
- Prefix every status line with the job id. At the end, show `F status`.
- `F new` refuses when the 5-hour quota is low; then start no more jobs, finish
  the running ones, and tell the user when the quota resets.

## Overlap holds

After a job's spec, `F overlap <id>` lists other active jobs that touch the same
files. If one of them is an earlier job **you** are running, hold this one:
`F set <id> note="waiting for <earlier id> (same files)"` and don't build it yet.
When the earlier job is merged or rejected: `git -C <worktree> merge <base>` (a
fast-forward, the held job has no commits yet), `F set <id> note=""`, then build.
Jobs from other sessions are not held; the conflict check handles them.

## Several sessions

The user can also run `/factory <feature>` or `/factory next` in several Claude
sessions in the same repo. Job ids and backlog items are claimed atomically by
`F new` and `F claim`; each session drives only the jobs it started or resumed.
