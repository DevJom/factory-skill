#!/usr/bin/env node
// Copyright (c) 2026 DevJom. MIT License, see ../LICENSE.
// Claude Code status line for the factory.
// Prints a one-line status and saves the plan's rate-limit usage to
// ~/.claude/factory/quota.json so the factory dashboard can show the remaining quota.
// Usage: node statusline.js [--then "<another status line command>"]
// --then passes the same stdin on to an existing status line (for example Orca's)
// and appends whatever it prints, so both keep working.
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const thenIdx = process.argv.indexOf('--then')
const thenCmd = thenIdx > -1 ? process.argv[thenIdx + 1] : null

let raw = ''
process.stdin.on('data', (d) => { raw += d })
process.stdin.on('end', () => {
  let data = {}
  try { data = JSON.parse(raw) } catch { /* print what we can */ }

  const limits = data.rate_limits
  if (limits && (limits.five_hour || limits.seven_day || limits.spend_limit)) {
    try {
      const dir = path.join(os.homedir(), '.claude', 'factory')
      fs.mkdirSync(dir, { recursive: true })
      const out = { ...limits, updated: Math.floor(Date.now() / 1000) }
      const tmp = path.join(dir, `quota.${process.pid}.tmp`)
      fs.writeFileSync(tmp, JSON.stringify(out))
      fs.renameSync(tmp, path.join(dir, 'quota.json'))
    } catch { /* never break the status line */ }
  }

  const parts = []
  if (data.model && data.model.display_name) parts.push(data.model.display_name)
  const ctx = data.context_window && data.context_window.used_percentage
  if (ctx != null) parts.push(`ctx ${Math.round(ctx)}%`)
  const left = (w) => Math.max(0, Math.round(100 - w.used_percentage))
  if (limits && limits.five_hour) {
    const resets = new Date(limits.five_hour.resets_at * 1000)
      .toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    parts.push(`5h ${left(limits.five_hour)}% left (resets ${resets})`)
  }
  if (limits && limits.seven_day) parts.push(`7d ${left(limits.seven_day)}% left`)

  if (thenCmd) {
    try {
      const r = spawnSync(thenCmd, { input: raw, shell: true, encoding: 'utf8', timeout: 4000, env: process.env, windowsHide: true })
      const extra = (r.stdout || '').trim()
      if (extra) parts.push(extra)
    } catch { /* the chained status line is optional */ }
  }
  process.stdout.write(parts.join(' · '))
})
