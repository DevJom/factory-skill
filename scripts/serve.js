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

const root = path.resolve(process.argv[2] || '.factory')
const port = Number(process.argv[3]) || 8765
const repo = path.dirname(root)
const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
const repoN = norm(repo)
const slug = repo.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()
const projectsDir = path.join(os.homedir(), '.claude', 'projects')
const quotaFile = path.join(os.homedir(), '.claude', 'factory', 'quota.json')
const RUNNING_MS = 2 * 60 * 1000

if (!fs.existsSync(root)) {
  console.error(`No such folder: ${root}`)
  process.exit(1)
}

// ---- Usage ----------------------------------------------------------------

const cache = new Map() // transcript path -> { key, data }

function readTranscript(file) {
  const st = fs.statSync(file)
  const key = `${st.mtimeMs}:${st.size}`
  const hit = cache.get(file)
  if (hit && hit.key === key) return hit.data

  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  const byMessage = new Map()
  let cwd = null, model = null, first = null, last = null
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue
    let o
    try { o = JSON.parse(line) } catch { continue }
    if (!cwd && o.cwd) cwd = o.cwd
    if (o.timestamp) { first = first || o.timestamp; last = o.timestamp }
    const m = o.type === 'assistant' && o.message
    if (!m || !m.usage) continue
    if (m.model) model = m.model
    // One API response is written as several lines sharing an id; the last
    // line carries the final usage.
    byMessage.set(m.id || o.uuid, m.usage)
  }
  for (const u of byMessage.values()) {
    tokens.input += u.input_tokens || 0
    tokens.output += u.output_tokens || 0
    tokens.cacheRead += u.cache_read_input_tokens || 0
    tokens.cacheWrite += u.cache_creation_input_tokens || 0
  }
  const data = { cwd, model, first, last, tokens, mtime: st.mtimeMs }
  cache.set(file, { key, data })
  return data
}

function listDirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
  } catch { return [] }
}

function loadJobs() {
  const jobs = {}
  for (const id of listDirs(path.join(root, 'jobs'))) {
    try { jobs[id] = JSON.parse(fs.readFileSync(path.join(root, 'jobs', id, 'job.json'), 'utf8')) } catch {}
  }
  return jobs
}

function usage() {
  const jobs = loadJobs()
  const byAgentId = {}
  for (const [jobId, job] of Object.entries(jobs)) {
    for (const a of job.agents || []) if (a && a.id) byAgentId[a.id] = jobId
    if (job.builder) byAgentId[job.builder] = jobId
  }
  const out = {}
  const now = Date.now()
  for (const project of listDirs(projectsDir)) {
    if (!project.toLowerCase().startsWith(slug)) continue
    for (const session of listDirs(path.join(projectsDir, project))) {
      const sub = path.join(projectsDir, project, session, 'subagents')
      let files = []
      try { files = fs.readdirSync(sub).filter((f) => f.endsWith('.meta.json')) } catch { continue }
      for (const metaName of files) {
        const agentId = metaName.replace(/^agent-/, '').replace(/\.meta\.json$/, '')
        const transcript = path.join(sub, metaName.replace(/\.meta\.json$/, '.jsonl'))
        let meta, t
        try {
          meta = JSON.parse(fs.readFileSync(path.join(sub, metaName), 'utf8'))
          t = readTranscript(transcript)
        } catch { continue }
        const cwdN = norm(t.cwd)
        if (cwdN !== repoN && !cwdN.startsWith(repoN + '/')) continue
        const m = String(meta.description || '').match(/^(\d{3}-[a-z0-9-]+)\s*:/i)
        const jobId = (m && jobs[m[1]] && m[1]) || byAgentId[agentId]
        if (!jobId) continue
        const status = meta.finished === true ? 'done' : now - t.mtime < RUNNING_MS ? 'running' : 'stopped'
        const job = out[jobId] || (out[jobId] = { tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, agents: [] })
        for (const k of Object.keys(job.tokens)) job.tokens[k] += t.tokens[k]
        job.agents.push({
          id: agentId, type: meta.agentType || 'agent', description: meta.description || '',
          model: t.model, status, started: t.first, last: t.last, tokens: t.tokens,
        })
      }
    }
  }
  for (const job of Object.values(out)) job.agents.sort((a, b) => String(a.started).localeCompare(String(b.started)))
  return { jobs: out, generated: new Date().toISOString() }
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
  try {
    if (url.pathname === '/api/usage') return send(res, 200, JSON.stringify(usage()), TYPES['.json'])
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
