# /factory resume [id]

Picks up a job whose orchestrator session ended mid-run. Without an id, list the
jobs in spec, build, review or approve (`F status`) and ask which to resume (or
all of them, as a multi-job session, see `reference/parallel.md`). If a job's
`updated` time is within the last 10 minutes another session may still drive it:
ask first.

Continue from the job's stage, using the steps in SKILL.md:

- **spec**: no worktree → `F worktree <id>`. `spec.md` exists → Build; otherwise Spec.
- **build**: spawn a fresh builder:
  `<paths> Continue: the previous builder was interrupted. Read build.md and the latest round folder, finish the work for round <round+1>, commit, and update build.md. Port: <port>.`
  Then Build check.
- **review**: `F verdicts <id>`; spawn only the reviewers listed in `missing`
  (in one message), then continue the Review round.
- **approve**: `F decision <id>` is APPROVE/ESCALATE → act on it; otherwise spawn the approver.
- Worktree folder gone (any stage)? `F worktree <id>` re-creates it from the branch.
- **needs-human, pr, merged, rejected**: nothing to resume; say what the job waits for.
