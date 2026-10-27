#!/usr/bin/env node
// Copyright (c) 2026 DevJom. MIT License, see ../LICENSE.
// Serves a repo's .factory/ folder for the dashboard, plus two read-only APIs:
//   /api/quota  plan rate-limit usage saved by statusline.js
//   /api/usage  agents and token counts per job, read from Claude Code's
//               subagent transcripts (token counts and agent types only)
// Usage: node serve.js <repo>/.factory [port]
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const { collectUsage } = require('./lib/usage')

const root = path.resolve(process.argv[2] || '.factory')
const port = Number(process.argv[3]) || 8765
const quotaFile = path.join(os.homedir(), '.claude', 'factory', 'quota.json')

if (!fs.existsSync(root)) {
  console.error(`No such folder: ${root}`)
  process.exit(1)
}

function quota() {
  try { return { available: true, ...JSON.parse(fs.readFileSync(quotaFile, 'utf8')) } } catch { return { available: false } }
}

// ---- Static files ---------------------------------------------------------

const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.md': 'text/markdown; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' }

function send(res, code, body, type) {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' })
  res.end(body)
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost')
  // Block DNS rebinding: a web page that resolves its own name to 127.0.0.1 sends its own Host.
  if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(req.headers.host || '')) return send(res, 403, 'Forbidden', 'text/plain')
  try {
    if (url.pathname === '/api/usage') return send(res, 200, JSON.stringify(collectUsage(root)), TYPES['.json'])
    if (url.pathname === '/api/quota') return send(res, 200, JSON.stringify(quota()), TYPES['.json'])
    const file = path.join(root, decodeURIComponent(url.pathname))
    if (file !== root && !file.startsWith(root + path.sep)) return send(res, 403, 'Forbidden', 'text/plain')
    if (!fs.existsSync(file)) return send(res, 404, 'Not found', 'text/plain')
    if (fs.statSync(file).isDirectory()) {
      // Same shape as python -m http.server's listing, which the dashboard parses.
      const links = fs.readdirSync(file, { withFileTypes: true })
        .map((d) => d.name + (d.isDirectory() ? '/' : ''))
        .map((n) => `<li><a href="${esc(encodeURIComponent(n.replace(/\/$/, '')) + (n.endsWith('/') ? '/' : ''))}">${esc(n)}</a></li>`)
      return send(res, 200, `<!doctype html><ul>${links.join('')}</ul>`, TYPES['.html'])
    }
    send(res, 200, fs.readFileSync(file), TYPES[path.extname(file)] || 'application/octet-stream')
  } catch (err) {
    send(res, 500, String(err.message), 'text/plain')
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`Factory dashboard: http://127.0.0.1:${port}/dashboard.html`)
})
