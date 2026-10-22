// Copyright (c) 2026 DevJom. MIT License, see ../../LICENSE.
// Token usage per factory job, read from Claude Code's subagent transcripts
// (token counts, model and agent type only; never message content).
const fs = require('fs')
const os = require('os')
const path = require('path')

const RUNNING_MS = 2 * 60 * 1000
const projectsDir = path.join(os.homedir(), '.claude', 'projects')
const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
const cache = new Map() // transcript path -> { key, data }

function listDirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
  } catch { return [] }
}

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

function loadJobs(factoryDir) {
  const jobs = {}
  for (const id of listDirs(path.join(factoryDir, 'jobs'))) {
    try { jobs[id] = JSON.parse(fs.readFileSync(path.join(factoryDir, 'jobs', id, 'job.json'), 'utf8')) } catch {}
  }
  return jobs
}

// Rough cost in "input-token equivalents": cache reads are cheap, output is dear.
function weighted(t) {
  return Math.round(t.input + t.cacheWrite * 1.25 + t.cacheRead * 0.1 + t.output * 5)
}

// { jobs: { <job-id>: { tokens, weighted, agents: [...] } }, generated }
function collectUsage(factoryDir) {
  const repo = path.dirname(path.resolve(factoryDir))
  const repoN = norm(repo)
  const slug = repo.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()
  const jobs = loadJobs(factoryDir)
  const byAgentId = {}
  for (const [jobId, job] of Object.entries(jobs)) {
    for (const a of job.agents || []) if (a && a.id) byAgentId[a.id] = jobId
    if (job.builder) byAgentId[job.builder] = jobId
  }
  const out = {}
  const now = Date.now()
  // The orchestrator session can live in any project folder (it need not have
  // started in this repo), so look everywhere. An agent belongs to a job when its
  // id is recorded in the job's job.json; otherwise, when its description starts
  // with "<job-id>:" and it ran in this repo (job ids repeat across repos).
  for (const project of listDirs(projectsDir)) {
    const inRepoProject = project.toLowerCase().startsWith(slug)
    for (const session of listDirs(path.join(projectsDir, project))) {
      const sub = path.join(projectsDir, project, session, 'subagents')
      let files = []
      try { files = fs.readdirSync(sub).filter((f) => f.endsWith('.meta.json')) } catch { continue }
      for (const metaName of files) {
        const agentId = metaName.replace(/^agent-/, '').replace(/\.meta\.json$/, '')
        let meta
        try { meta = JSON.parse(fs.readFileSync(path.join(sub, metaName), 'utf8')) } catch { continue }
        const m = String(meta.description || '').match(/^(\d{3}-[a-z0-9-]+)\s*:/i)
        const byDesc = m && jobs[m[1]] ? m[1] : null
        if (!byAgentId[agentId] && !byDesc) continue
        let t
        try { t = readTranscript(path.join(sub, metaName.replace(/\.meta\.json$/, '.jsonl'))) } catch { continue }
        let jobId = byAgentId[agentId]
        if (!jobId) {
          const cwdN = norm(t.cwd)
          if (inRepoProject || cwdN === repoN || cwdN.startsWith(repoN + '/')) jobId = byDesc
        }
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
  for (const job of Object.values(out)) {
    job.agents.sort((a, b) => String(a.started).localeCompare(String(b.started)))
    job.weighted = weighted(job.tokens)
  }
  return { jobs: out, generated: new Date().toISOString() }
}

module.exports = { collectUsage, weighted, norm }
