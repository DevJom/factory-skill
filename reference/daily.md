# Daily commands: hello and bye

Journal: `<repo>/.factory/journal/<YYYY-MM-DD>.md` (local date), one per day.
Create it with a `# <YYYY-MM-DD>` heading if missing. Always append; several
sessions may write the same day.

## /factory hello | hi | morning

Read and suggest only; start nothing (jobs cost money).

1. "Since last time" = the last entry of the newest journal file, else 24 hours ago.
2. Gather, cheaply:
   - `F status`, `F quota`.
   - Done: jobs that became merged/rejected since then; `git log --oneline --since=<then> <base>`.
   - Waiting: needs-human jobs, "ready to test" before "your call".
   - Interrupted: jobs in spec/build/review/approve whose `updated` is older than 10 minutes.
   - Backlog: the `- [ ]` lines of `.factory/backlog.md`.
   - Repo: main checkout on `<base>` and clean? Unpushed commits (`git log --oneline @{u}..<base>`)?
     Worktrees left over from merged/rejected jobs (`git worktree list`)?
   - The `## Next time` list of the last goodbye.
3. Reply:
   ```
   Good morning. Since <when>:
   Done:        ...
   Waiting:     ... (+ the command for each)
   Interrupted: ... → /factory resume <id>
   Backlog:     <n> items, first 3 listed
   Quota:       5h <x>% left (resets <time>), 7d <y>% left
   Heads-up:    unpushed commits, dirty checkout, leftover folders

   Suggested plan:
   1. ...
   ```
   Plan order: what waits on the human (it unblocks merges), interrupted jobs, new
   backlog work (skip if the 5-hour quota is under 15%), last time's plan. Leave out
   empty sections. Ask what to start.
4. Append `### <HH:MM> hello` and one line (waiting / interrupted / backlog counts).

## /factory bye | goodbye [notes]

1. "Today" = since the earliest entry of today's journal, else the start of the day.
2. Jobs this session is still running: tell the user they stop when the session
   closes; ask whether to wait for them or leave them for `/factory resume`.
   Spawn nothing new after goodbye.
3. Stop every dev server started by `/factory test` (`dev_terminal`; see
   `reference/human.md`, approve step 1).
4. Backlog suggestions from today's jobs: review `## Notes`, the approver's `## Why`
   and `## For the human`, the spec's `## Out of scope`, rejected ideas worth retrying,
   and the user's `[notes]`. Read only those sections. Show one-line items and ask
   which to add; append the chosen ones as `- [ ] <item>`. Never add without asking.
5. For each job that ended today: `F cost <id> --save` (use `weighted`).
6. Append to the journal:
   ```markdown
   ### <HH:MM> goodbye

   ## Done
   - 004-dark-mode: merged (1 round, 640k weighted tokens)
   ## Waiting for you
   - 005-csv-export: ready to test → /factory test 005-csv-export
   ## In progress / interrupted
   - 007-pagination: stopped at review round 2 → /factory resume 007-pagination
   ## Added to backlog
   - ...
   ## Cost
   - today: <sum of weighted> weighted tokens over <n> jobs; quota 5h <x>% / 7d <y>% left
   ## Next time
   1. ...
   ```
   Leave out empty sections.
7. Reply with the same summary plus what only the human can do (unpushed commits,
   dirty checkout, leftover worktrees). End with `See you next time - start with /factory hello.`
