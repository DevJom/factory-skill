# Factory

A software factory for Claude Code, maintained by **DevJom**.

Type `/factory <feature>` and a team of agents writes a spec, builds it in its own
worktree, reviews it from four angles (security, UX, UI, code), and hands it to
you to test. Nothing reaches your main branch until you approve it.

```
feature → spec-writer → builder → [security, ux, ui, code] → approver → you test → merge
```

## Install

Requires [Claude Code](https://claude.com/claude-code), git and Node.js. Orca and
[`agent-browser`](https://github.com/vercel-labs/agent-browser) are optional.

macOS / Linux:

```bash
git clone https://github.com/DevJom/factory-skill ~/.claude/skills/factory
mkdir -p ~/.claude/agents && cp ~/.claude/skills/factory/agents/*.md ~/.claude/agents/
```

Windows (PowerShell):

```powershell
git clone https://github.com/DevJom/factory-skill "$HOME\.claude\skills\factory"
New-Item -ItemType Directory -Force "$HOME\.claude\agents" | Out-Null
Copy-Item "$HOME\.claude\skills\factory\agents\*.md" "$HOME\.claude\agents\"
```

Start a new Claude Code session, open a git project with everything committed,
and run `/factory hello` or `/factory <feature>`.

**Optional, plan quota on the dashboard:** set the status line in
`~/.claude/settings.json` (if you already have one, add `--then "<your command>"`
to keep it):

```json
"statusLine": { "type": "command", "command": "node ~/.claude/skills/factory/scripts/statusline.js" }
```

On Windows use the full path, for example
`node \"C:/Users/<you>/.claude/skills/factory/scripts/statusline.js\"`.

## Usage

```
/factory <feature>                 build one feature
/factory "feature A" "feature B"   build several in parallel
/factory next [n]                  build the next item(s) from .factory/backlog.md
/factory status                    all jobs at a glance
/factory test <job-id>             run a finished job and try it
/factory approve <job-id>          merge it into your base branch (never pushes)
/factory rework <job-id> "<note>"  send it back with feedback
/factory reject <job-id>           drop it
/factory resume [job-id]           continue a job whose session closed
/factory dashboard                 live board with quota and tokens
/factory hello | bye               daily briefing and daily summary
```

## Credits

- **Original author:** [ZazenCodes](https://github.com/zazencodes), the
  "Software Factory for Claude Code"
  ([zazencodes-season-3/src/software-factory-claude-code](https://github.com/zazencodes/zazencodes-season-3/tree/main/src/software-factory-claude-code)):
  the original loop, the seven agent roles and their review checklists, and
  the first version of the dashboard.
- **Modified and improved by:** DevJom, 2026.

## What DevJom changed and added

- Installed globally (`~/.claude/skills/factory` and `~/.claude/agents/factory-*.md`)
  instead of being copied into each repo; per-repo state lives in a git-ignored
  `.factory/` folder.
- **Human test gate:** the factory never merges on its own; every job waits for
  `/factory test` and `/factory approve`.
- **Orca worktrees** when Orca is running, with live status on the Orca cards;
  plain git worktrees otherwise.
- **Parallel jobs from one session** (`/factory "a" "b"`, `/factory next 3`), with
  overlap warnings, holds for jobs touching the same files, a merge lock, and a
  conflict check that sends the builder to sync with the base branch.
- Configurable base branch (`git config factory.base`), Windows path handling.
- Skips UX/UI reviews for changes with no visible surface.
- New commands: `test`, `reject`, `resume`, `status`, `dashboard`,
  `hello`/`hi`/`morning` (daily briefing) and `bye`/`goodbye` (daily summary,
  backlog suggestions, journal).
- **Dashboard:** remaining plan quota, which agent is running on each job, and
  tokens per job and per agent (`scripts/serve.js`, `scripts/statusline.js`).
- Cost-reduction plan in `TODO.md`.

## Files

```
SKILL.md                 the orchestrator (/factory)
assets/dashboard.html    the board, copied into each repo's .factory/
scripts/serve.js         dashboard server with quota and token APIs
scripts/statusline.js    status line that records plan quota (chains Orca's)
TODO.md                  improvement backlog
agents/factory-*.md      the seven agents (install into ~/.claude/agents/)
```

## License

DevJom's modifications and additions are released under the MIT License (see
`LICENSE`). Portions from the original ZazenCodes software factory remain the
work of ZazenCodes; the original repository does not include a license.
