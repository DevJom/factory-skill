# /factory dashboard

Start the server in the background:
`node <skill folder>/scripts/serve.js <repo>/.factory 8765` (another port if taken).
Without node: `python -m http.server 8765 --bind 127.0.0.1 --directory <repo>/.factory`
(or `python3`); the board works, without quota and tokens.

Tell the user to open `http://127.0.0.1:8765/dashboard.html` (it polls every 2 s)
and that `#<job-id>` or `#<job-id>/__agents` opens a job directly.

If the header says `quota: n/a`, the status line has not run yet. It needs, in
`~/.claude/settings.json`, a `statusLine` command running
`node "<skill folder>/scripts/statusline.js"`, and a Claude Code terminal session
on a Pro or Max plan. If another tool already owns the status line (Orca installs
`claude-statusline.cmd`), chain it:
`node "<skill folder>/scripts/statusline.js" --then "<existing command>"`.
If a tool later overwrites the setting, offer to re-chain it; never drop the
other tool's command.
