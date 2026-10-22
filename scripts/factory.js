#!/usr/bin/env node
// Copyright (c) 2026 DevJom. MIT License, see ../LICENSE.
// Bookkeeping helper for the /factory orchestrator. Every command prints one
// line of JSON (except `status`), so the orchestrator spends few tokens per step.
//
//   setup                         prepare .factory/, detect base, Orca, browser, quota
//   new "<feature>" [--backlog "<item>"] [--force]   claim a job id (quota guard)
//   worktree <id>                 create the job's worktree (Orca or git)
//   set <id> key=value ...        update job.json (dotted keys ok) + Orca card
//   agent <id> <role> <round> <agent-id>   record a spawned agent
//   overlap <id>                  compare "Files likely touched" with active jobs
//   route <id> <role>             model + effort for this role (size/risk/resumes)
//   round <id>                    start the next review round: diff, carry/skip, which to run
//   verdicts <id>                 read the current round's verdicts into job.json
//   build <id> | decision <id>    first line of build.md / decision.md
//   conflict <id>                 merge-tree check against the base branch
//   cost <id> [--save]            tokens, weighted cost and budget for the job
//   quota                         remaining plan quota
//   claim [n]                     claim backlog items for /factory next
//   status                        table of all jobs
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const { collectUsage, norm } = require('./lib/usage')

const SKILL_DIR = path.resolve(__dirname, '..')
const REVIEWERS = ['security', 'ux', 'ui', 'code']
const ACTIVE = new Set(['spec', 'build', 'review', 'approve'])
const QUOTA_MIN_LEFT = 15 // % of the 5-hour window
const BUDGET = { S: 400e3, M: 1e6, L: 2.5e6 } // weighted tokens per job
const FRONTEND = /\.(html?|css|scss|sass|less|vue|svelte|jsx|tsx|astro|hbs|ejs|njk|liquid|erb)$|(^|\/)(components|pages|views|styles|templates|layouts|app\/.*page\.)/i
const RISKY = /(auth|login|logout|session|password|passwd|permission|role|acl|oauth|jwt|payment|billing|stripe|paypal|checkout|invoice|upload|secret|token|crypto|migrat|schema\.prisma|\.sql$|(^|\/)\.env|dockerfile|docker-compose|\.github\/workflows|\.gitlab-ci|(^|\/)ci\/|deploy|firebase\.json|\.rules$|vercel\.json|netlify\.toml|wrangler\.toml|(^|\/)package\.json$|package-lock\.json|yarn\.lock|pnpm-lock|requirements\.txt|pyproject\.toml|go\.mod|cargo\.toml|gemfile|mail|smtp)/i

const posix = (p) => String(p).replace(/\\/g, '/')
const now = () => new Date().toISOString()
const out = (o) => { process.stdout.write(JSON.stringify(o) + '\n') }
const fail = (error, extra = {}) => { out({ ok: false, error, ...extra }); process.exit(1) }
const read = (f) => { try { return fs.readFileSync(f, 'utf8') } catch { return null } }
const firstLine = (f) => { const t = read(f); return t === null ? null : t.replace(/\r/g, '').split('\n')[0].trim() }

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true, timeout: 60000, ...opts })
  return { code: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() || (r.error && r.error.message) || '' }
}
const git = (args, cwd) => run('git', args, { cwd })

// ---- Repo and state ---------------------------------------------------------

function repoRoot() {
  const r = git(['rev-parse', '--show-toplevel'], process.cwd())
  if (r.code !== 0) fail('not-a-git-repo', { hint: 'run git init and make a first commit' })
  return posix(r.out)
}
const REPO = ['setup', 'new', 'worktree', 'set', 'agent', 'overlap', 'route', 'round', 'verdicts', 'build', 'decision', 'conflict', 'cost', 'claim', 'status'].includes(process.argv[2]) ? repoRoot() : null
const FDIR = REPO && `${REPO}/.factory`
const stateFile = () => `${FDIR}/state.json`
const loadState = () => { try { return JSON.parse(read(stateFile())) || {} } catch { return {} } }
const saveState = (s) => fs.writeFileSync(stateFile(), JSON.stringify(s, null, 2))
const jobDir = (id) => `${FDIR}/jobs/${id}`
function loadJob(id) {
  const t = read(`${jobDir(id)}/job.json`)
  if (!t) fail('no-such-job', { id })
  return JSON.parse(t)
}
function saveJob(job) {
  job.updated = now()
  fs.writeFileSync(`${jobDir(job.id)}/job.json`, JSON.stringify(job, null, 2))
}

// ---- Quota ------------------------------------------------------------------

function quota() {
  const t = read(path.join(os.homedir(), '.claude', 'factory', 'quota.json'))
  if (!t) return { available: false }
  const q = JSON.parse(t)
  const s = Date.now() / 1000
  const left = (w) => (w && w.used_percentage != null && !(w.resets_at && w.resets_at < s)) ? Math.max(0, Math.round(100 - w.used_percentage)) : null
  return {
    available: true,
    fiveHourLeft: left(q.five_hour), sevenDayLeft: left(q.seven_day),
    resetsAt: q.five_hour && q.five_hour.resets_at ? new Date(q.five_hour.resets_at * 1000).toISOString() : null,
    stale: !q.updated || s - q.updated > 15 * 60,
  }
}

// ---- Orca -------------------------------------------------------------------

function orcaExe() {
  if (process.env.ORCA_CLI_COMMAND) return process.env.ORCA_CLI_COMMAND
  return process.platform === 'linux' ? 'orca-ide' : 'orca'
}
function orca(args, exe) {
  // No shell: arguments such as card comments contain spaces. On Windows this
  // finds orca.exe; a .cmd-only install falls back to the shell with quoting.
  let r = run(exe, [...args, '--json'], { timeout: 30000 })
  if (r.code === null && process.platform === 'win32') {
    const q = (a) => /[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a
    r = run([exe, ...args, '--json'].map(q).join(' '), [], { shell: true, timeout: 30000 })
  }
  if (r.code !== 0) return { ok: false, err: r.err || r.out }
  try { return { ok: true, json: JSON.parse(r.out) } } catch { return { ok: false, err: r.out } }
}
function detectOrca() {
  if (process.env.FACTORY_NO_ORCA === '1') return { mode: 'git', reason: 'FACTORY_NO_ORCA=1' }
  if (git(['config', 'factory.orca'], REPO).out === 'false') return { mode: 'git', reason: 'git config factory.orca false' }
  const exe = orcaExe()
  const list = orca(['repo', 'list'], exe)
  if (!list.ok) return { mode: 'git', reason: 'orca not running or not installed' }
  const repos = (list.json.result && list.json.result.repos) || []
  let repo = repos.find((r) => norm(r.path) === norm(REPO))
  let added = false
  if (!repo) {
    const add = orca(['repo', 'add', '--path', REPO], exe)
    if (!add.ok) return { mode: 'git', reason: `orca repo add failed: ${String(add.err).slice(0, 120)}` }
    repo = findDeep(add.json, (o) => o && typeof o.id === 'string' && o.path) || {}
    added = true
  }
  return { mode: 'orca', exe, repoId: repo.id, added }
}
function findDeep(o, pred) {
  if (pred(o)) return o
  if (o && typeof o === 'object') for (const v of Object.values(o)) { const f = findDeep(v, pred); if (f) return f }
  return null
}
function syncCard(job, explicitComment) {
  if (!job.orca) return
  const st = loadState()
  if (!st.exe) return
  const comment = explicitComment || cardComment(job)
  const args = ['worktree', 'set', '--worktree', `id:${job.orca}`, '--comment', comment]
  if (ACTIVE.has(job.stage)) args.push('--workspace-status', 'in-progress')
  if (job.stage === 'needs-human') args.push('--workspace-status', 'in-review', '--unread')
  orca(args, st.exe) // a failed card update is not an error
}
function cardComment(job) {
  if (job.note) return `${job.id}: ${job.note}`
  if (job.stage === 'review') {
    const v = REVIEWERS.map((k) => `${k} ${job.reviews[k]}`).join(', ')
    return `round ${job.round}: ${v}`
  }
  if (job.stage === 'build') return job.round ? `fixing round ${job.round} findings` : 'building'
  return `${job.id}: ${job.stage}`
}

// ---- Commands ---------------------------------------------------------------

const cmds = {}

cmds.setup = () => {
  if (git(['rev-parse', 'HEAD'], REPO).code !== 0) fail('no-commits', { hint: 'make a first commit' })
  const created = !fs.existsSync(FDIR)
  fs.mkdirSync(`${FDIR}/jobs`, { recursive: true })
  const src = path.join(SKILL_DIR, 'assets', 'dashboard.html')
  if (read(`${FDIR}/dashboard.html`) !== read(src)) fs.copyFileSync(src, `${FDIR}/dashboard.html`)
  if (!fs.existsSync(`${FDIR}/backlog.md`)) {
    fs.writeFileSync(`${FDIR}/backlog.md`, '# Backlog\n\n`/factory next` builds the first unchecked item and checks it off with its job id.\n\n')
  }
  const common = git(['rev-parse', '--git-common-dir'], REPO).out
  const exclude = path.resolve(REPO, common, 'info', 'exclude')
  const ex = read(exclude) || ''
  if (!ex.split(/\r?\n/).includes('.factory/')) {
    fs.mkdirSync(path.dirname(exclude), { recursive: true })
    fs.appendFileSync(exclude, (ex && !ex.endsWith('\n') ? '\n' : '') + '.factory/\n')
  }
  const hasBranch = (b) => git(['show-ref', '--verify', '--quiet', `refs/heads/${b}`], REPO).code === 0
  const base = git(['config', 'factory.base'], REPO).out || (hasBranch('main') && 'main') || (hasBranch('master') && 'master') || git(['branch', '--show-current'], REPO).out
  const claudeMd = fs.existsSync(`${REPO}/AGENTS.md`) || fs.existsSync(`${REPO}/CLAUDE.md`)
  const browser = run(process.platform === 'win32' ? 'where' : 'which', ['agent-browser']).code === 0
  const o = detectOrca()

  const prev = loadState()
  const notices = []
  if (prev.base !== base) notices.push(`base branch: ${base}`)
  if (prev.mode !== o.mode) notices.push(o.mode === 'orca' ? 'worktrees: Orca' : `worktrees: git (${o.reason})`)
  if (o.added) notices.push('added this repo to Orca')
  if (!claudeMd && prev.claudeMd !== false) notices.push('no AGENTS.md/CLAUDE.md: agents will discover commands themselves; run /init first for better, cheaper jobs')
  if (!browser && prev.browser !== false) notices.push('agent-browser not installed: no in-browser checks')
  saveState({ ...prev, base, mode: o.mode, exe: o.exe || null, repoId: o.repoId || null, claudeMd, browser })
  out({ ok: true, repo: REPO, base, mode: o.mode, browser, claudeMd, created, notices, quota: quota() })
}

function slugify(feature) {
  const stop = new Set(['a', 'an', 'the', 'to', 'of', 'for', 'on', 'in', 'and', 'with', 'add', 'make', 'create', 'i', 'my', 'our', 'that', 'this', 'is', 'be', 'it', 'when', 'from', 'as', 'by', 'so', 'can'])
  const words = feature.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter((w) => w && !stop.has(w))
  return (words.slice(0, 3).join('-') || 'feature').slice(0, 40)
}

cmds.new = (args) => {
  const flags = parseFlags(args)
  const feature = flags._.join(' ').trim()
  if (!feature) fail('usage: new "<feature>"')
  const q = quota()
  if (!flags.force && q.available && !q.stale && q.fiveHourLeft != null && q.fiveHourLeft < QUOTA_MIN_LEFT) {
    fail('low-quota', { fiveHourLeft: q.fiveHourLeft, resetsAt: q.resetsAt, hint: 'wait for the reset or pass --force' })
  }
  const st = loadState()
  const slug = flags.slug || slugify(feature)
  let n = Math.max(0, ...fs.readdirSync(`${FDIR}/jobs`).map((d) => parseInt(d, 10)).filter((x) => !isNaN(x))) + 1
  let id
  for (;; n++) {
    id = `${String(n).padStart(3, '0')}-${slug}`
    try { fs.mkdirSync(jobDir(id)); break } catch (e) { if (e.code !== 'EEXIST') throw e }
  }
  const job = {
    id, feature, branch: '', base: st.base || 'main', worktree: '', orca: '', dev_terminal: '',
    stage: 'spec', round: 0, resumes: 0, reviews: Object.fromEntries(REVIEWERS.map((k) => [k, 'pending'])),
    surface: '', size: '', risk: '', builder: '', overlaps: [], agents: [], reviewed: {}, note: '',
    started: now(), updated: now(),
  }
  saveJob(job)
  if (flags.backlog) linkBacklog(flags.backlog, id)
  out({ ok: true, id, ports: ports(n) })
}

const ports = (n) => ({ builder: 5100 + 10 * n, ux: 5101 + 10 * n, ui: 5102 + 10 * n, test: 5103 + 10 * n })

cmds.worktree = ([id]) => {
  const job = loadJob(id)
  const st = loadState()
  let fallback = null
  if (st.mode === 'orca' && st.exe && st.repoId) {
    const r = orca(['worktree', 'create', '--repo', `id:${st.repoId}`, '--name', `factory-${id}`, '--no-parent', '--base-branch', job.base, '--comment', `${id}: writing spec`], st.exe)
    const wt = r.ok && findDeep(r.json, (o) => o && typeof o.id === 'string' && o.id.includes('::'))
    if (wt) {
      job.orca = wt.id
      job.worktree = posix(wt.path || wt.id.split('::').slice(1).join('::'))
      job.branch = git(['branch', '--show-current'], job.worktree).out
    } else fallback = `orca worktree create failed: ${String(r.err || 'no worktree id in result').slice(0, 160)}`
  }
  if (!job.worktree) {
    const wt = `${posix(path.dirname(REPO))}/${path.basename(REPO)}-factory/${id}`
    const r = git(['worktree', 'add', '-b', `factory/${id}`, wt, job.base], REPO)
    if (r.code !== 0) fail('worktree-failed', { detail: r.err.slice(0, 300) })
    job.worktree = wt
    job.branch = `factory/${id}`
  }
  saveJob(job)
  out({ ok: true, worktree: job.worktree, branch: job.branch, orca: !!job.orca, fallback })
}

cmds.set = (args) => {
  const [id, ...pairs] = args
  const job = loadJob(id)
  let comment = null
  for (const p of pairs) {
    const i = p.indexOf('=')
    if (i < 1) fail(`bad pair: ${p}`)
    const key = p.slice(0, i)
    let val = p.slice(i + 1)
    try { val = JSON.parse(val) } catch { /* plain string */ }
    if (key === 'comment') { comment = String(val); continue }
    const parts = key.split('.')
    let o = job
    for (const k of parts.slice(0, -1)) o = o[k] = o[k] && typeof o[k] === 'object' ? o[k] : {}
    o[parts.at(-1)] = val
  }
  saveJob(job)
  syncCard(job, comment)
  out({ ok: true })
}

cmds.agent = ([id, role, round, agentId]) => {
  const job = loadJob(id)
  job.agents = job.agents || []
  job.agents.push({ id: agentId, role, round: Number(round) || 0 })
  if (role === 'build') job.builder = agentId
  saveJob(job)
  out({ ok: true })
}

function specFiles(id) {
  const lines = (read(`${jobDir(id)}/spec.md`) || '').replace(/\r/g, '').split('\n')
  const start = lines.findIndex((l) => /^##\s+Files likely touched/i.test(l))
  if (start < 0) return []
  const body = []
  for (const l of lines.slice(start + 1)) { if (/^##\s/.test(l)) break; body.push(l) }
  return body.join(' ').split(/[\s,]+/).map((s) => s.replace(/^[-*`]+|[`:]+$/g, '').trim()).filter((s) => s && /[./]/.test(s))
}

function readSpecMeta(job) {
  const spec = read(`${jobDir(job.id)}/spec.md`) || ''
  const get = (k) => { const m = spec.match(new RegExp(`^${k}:\\s*(\\w+)`, 'mi')); return m ? m[1] : '' }
  job.surface = (get('Surface') || job.surface || 'ui').toLowerCase()
  job.size = (get('Size') || job.size || 'M').toUpperCase()
  job.risk = (get('Risk') || job.risk || 'low').toLowerCase()
}

cmds.overlap = ([id]) => {
  const job = loadJob(id)
  readSpecMeta(job)
  const mine = new Set(specFiles(id))
  const overlaps = []
  for (const other of fs.readdirSync(`${FDIR}/jobs`)) {
    if (other === id) continue
    const t = read(`${jobDir(other)}/job.json`)
    if (!t) continue
    const o = JSON.parse(t)
    if (!ACTIVE.has(o.stage) && o.stage !== 'needs-human') continue
    const shared = specFiles(other).filter((f) => mine.has(f))
    if (shared.length) overlaps.push({ id: other, stage: o.stage, files: shared })
  }
  job.overlaps = overlaps.map((o) => o.id)
  saveJob(job)
  out({ ok: true, surface: job.surface, size: job.size, risk: job.risk, overlaps })
}

// Model and effort per role, from the spec's Size and Risk. Builder effort goes
// up one step per resume. FACTORY_ROUTING=off returns {} (agent defaults).
const STEPS = ['low', 'medium', 'high']
const TABLE = {
  S: { build: ['sonnet', 'medium'], security: ['sonnet', 'low'], code: ['sonnet', 'low'], ux: ['sonnet', 'low'], ui: ['sonnet', 'low'], approve: ['sonnet', 'low'] },
  M: { build: ['opus', 'medium'], security: ['sonnet', 'medium'], code: ['sonnet', 'medium'], ux: ['sonnet', 'low'], ui: ['sonnet', 'low'], approve: ['sonnet', 'medium'] },
  L: { build: ['opus', 'high'], security: ['opus', 'high'], code: ['sonnet', 'high'], ux: ['sonnet', 'medium'], ui: ['sonnet', 'medium'], approve: ['opus', 'medium'] },
}
cmds.route = ([id, role]) => {
  if (process.env.FACTORY_ROUTING === 'off') return out({ ok: true })
  if (role === 'spec') return out({ ok: true, model: 'opus', effort: 'medium' })
  const job = loadJob(id)
  readSpecMeta(job)
  const size = TABLE[job.size] ? job.size : 'M'
  let [model, effort] = (TABLE[size][role] || ['sonnet', 'medium'])
  if (job.risk === 'high') {
    if (role === 'security') [model, effort] = ['opus', 'high']
    if (role === 'approve') [model, effort] = ['opus', 'medium']
    if (role === 'build' && model === 'sonnet') model = 'opus'
  }
  // Retries climb one step at a time: effort first, then sonnet → opus.
  if (role === 'build' && job.resumes > 0) {
    effort = STEPS[Math.min(STEPS.length - 1, STEPS.indexOf(effort) + 1)]
    if (job.resumes >= 2 && model === 'sonnet') model = 'opus'
  }
  out({ ok: true, model, effort, size: job.size, risk: job.risk })
}

function diffNames(range, cwd) {
  const r = git(['diff', '--name-only', range], cwd)
  return r.code === 0 ? r.out.split('\n').map((s) => s.trim()).filter(Boolean) : []
}

// Start the next review round: write the diff once, decide which reviewers run,
// write PASS stubs for skipped or carried-forward lenses.
cmds.round = ([id]) => {
  const job = loadJob(id)
  readSpecMeta(job)
  const N = (job.round || 0) + 1
  const dir = `${jobDir(id)}/round-${N}`
  fs.mkdirSync(dir, { recursive: true })
  const range = `${job.base}...${job.branch}`
  const files = diffNames(range, REPO)
  const patch = git(['diff', range], REPO)
  fs.writeFileSync(`${dir}/diff.patch`, patch.out + '\n')
  fs.writeFileSync(`${dir}/files.txt`, files.join('\n') + '\n')
  const head = git(['rev-parse', job.branch], REPO).out
  const frontEnd = files.some((f) => FRONTEND.test(f))
  const risky = files.filter((f) => RISKY.test(f))

  const prev = N > 1 ? job.reviews : null
  let delta = files
  if (N > 1 && job.reviewed && job.reviewed[N - 1]) delta = diffNames(`${job.reviewed[N - 1]}..${head}`, REPO)
  const deltaFront = delta.some((f) => FRONTEND.test(f))
  const deltaRisky = delta.some((f) => RISKY.test(f))

  const run = [], carried = [], skipped = []
  for (const k of REVIEWERS) {
    if ((k === 'ux' || k === 'ui') && job.surface === 'none' && !frontEnd) { skipped.push(k); continue }
    if (N === 1 || k === 'code' || (prev && prev[k] !== 'PASS')) { run.push(k); continue }
    if ((k === 'ux' || k === 'ui') && deltaFront) { run.push(k); continue }
    if (k === 'security' && deltaRisky) { run.push(k); continue }
    carried.push(k)
  }
  const stub = (why) => `VERDICT: PASS\n\n## Findings\nNone.\n\n## Notes\n${why}\n`
  for (const k of skipped) fs.writeFileSync(`${dir}/review-${k}.md`, stub('Skipped by the orchestrator: the spec says Surface: none and the diff has no front-end files.'))
  for (const k of carried) fs.writeFileSync(`${dir}/review-${k}.md`, stub(`Carried forward from round ${N - 1} (PASS): the changes since then (${delta.length} file(s)) do not touch ${k === 'security' ? 'security-sensitive' : 'front-end'} files.`))

  job.stage = 'review'
  job.round = N
  job.reviews = Object.fromEntries(REVIEWERS.map((k) => [k, run.includes(k) ? 'pending' : 'PASS']))
  job.reviewed = { ...(job.reviewed || {}), [N]: head }
  job.note = ''
  saveJob(job)
  syncCard(job)
  out({ ok: true, round: N, run, carried, skipped, files: files.length, frontEnd, risky })
}

cmds.verdicts = ([id]) => {
  const job = loadJob(id)
  const dir = `${jobDir(id)}/round-${job.round}`
  const verdicts = {}, changes = [], invalid = [], missing = []
  for (const k of REVIEWERS) {
    const l = firstLine(`${dir}/review-${k}.md`)
    if (l === null) { missing.push(k); continue }
    const m = l.match(/^VERDICT:\s*(PASS|CHANGES)$/)
    if (!m) { invalid.push(k); continue }
    verdicts[k] = m[1]
    job.reviews[k] = m[1]
    if (m[1] === 'CHANGES') changes.push(`round-${job.round}/review-${k}.md`)
  }
  saveJob(job)
  syncCard(job)
  out({ ok: true, round: job.round, verdicts, missing, invalid, changes, done: !missing.length && !invalid.length })
}

cmds.build = ([id]) => {
  const l = firstLine(`${jobDir(id)}/build.md`)
  out({ ok: true, status: l === null ? 'missing' : (l.match(/^STATUS:\s*(READY|BLOCKED)$/) || [])[1] || 'invalid' })
}

cmds.decision = ([id]) => {
  const l = firstLine(`${jobDir(id)}/decision.md`)
  out({ ok: true, decision: l === null ? 'missing' : (/^(APPROVE|ESCALATE)$/.test(l) ? l : 'invalid') })
}

cmds.conflict = ([id]) => {
  const job = loadJob(id)
  const r = git(['merge-tree', '--write-tree', job.base, job.branch], REPO)
  if (r.code !== 0 && r.code !== 1) fail('merge-tree-failed', { detail: r.err.slice(0, 200) })
  out({ ok: true, clean: r.code === 0 })
}

cmds.cost = (args) => {
  const flags = parseFlags(args)
  const id = flags._[0]
  const job = loadJob(id)
  const u = collectUsage(FDIR).jobs[id]
  const size = BUDGET[job.size] ? job.size : 'M'
  const res = {
    ok: true, agents: u ? u.agents.length : 0, weighted: u ? u.weighted : 0, budget: BUDGET[size],
    overBudget: !!u && u.weighted > BUDGET[size], tokens: u ? u.tokens : null,
  }
  if (flags.save) { job.cost = { weighted: res.weighted, agents: res.agents, tokens: res.tokens, at: now() }; saveJob(job) }
  out(res)
}

cmds.quota = () => out({ ok: true, ...quota(), minLeft: QUOTA_MIN_LEFT })

cmds.claim = ([n]) => {
  const file = `${FDIR}/backlog.md`
  const lock = `${FDIR}/backlog.lock`
  for (let i = 0; ; i++) {
    try { fs.mkdirSync(lock); break } catch {
      if (i > 50) fail('backlog-locked')
      const t = Date.now(); while (Date.now() - t < 100) { /* wait */ }
    }
  }
  try {
    const lines = (read(file) || '').split('\n')
    const items = []
    for (let i = 0; i < lines.length && items.length < (Number(n) || 1); i++) {
      const m = lines[i].match(/^(\s*)- \[ \] (.+?)\s*$/)
      if (!m) continue
      items.push(m[2])
      lines[i] = `${m[1]}- [x] ${m[2]} → claimed`
    }
    fs.writeFileSync(file, lines.join('\n'))
    out({ ok: true, items })
  } finally { fs.rmdirSync(lock) }
}

function linkBacklog(item, id) {
  const file = `${FDIR}/backlog.md`
  const t = read(file)
  if (t) fs.writeFileSync(file, t.replace(`- [x] ${item} → claimed`, `- [x] ${item} → ${id}`))
}

cmds.status = () => {
  const rows = []
  for (const id of fs.readdirSync(`${FDIR}/jobs`).sort()) {
    const t = read(`${jobDir(id)}/job.json`)
    if (!t) continue
    const j = JSON.parse(t)
    const rv = REVIEWERS.map((k) => `${k === 'security' ? 'sec' : k}:${({ PASS: '✓', CHANGES: '✗', pending: '·' })[j.reviews[k]] || '?'}`).join(' ')
    rows.push({ order: j.stage === 'needs-human' ? 0 : ACTIVE.has(j.stage) ? 1 : 2, line: `${id.padEnd(28)} ${j.stage.padEnd(11)} r${j.round} ${rv}  ${j.note || ''}` })
  }
  rows.sort((a, b) => a.order - b.order)
  process.stdout.write((rows.map((r) => r.line).join('\n') || 'no jobs yet') + '\n')
}

function parseFlags(args) {
  const f = { _: [] }
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a.startsWith('--')) {
      const k = a.slice(2)
      if (i + 1 < args.length && !args[i + 1].startsWith('--')) f[k] = args[++i]
      else f[k] = true
    } else f._.push(a)
  }
  return f
}

const [cmd, ...rest] = process.argv.slice(2)
if (!cmds[cmd]) {
  process.stdout.write(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 20).map((l) => l.replace(/^\/\/ ?/, '')).join('\n') + '\n')
  process.exit(cmd ? 1 : 0)
}
cmds[cmd](rest)
