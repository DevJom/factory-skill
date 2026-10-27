#!/usr/bin/env node
// Copyright (c) 2026 DevJom. MIT License, see ../LICENSE.
// Self-test for factory.js: builds a throwaway repo (and a throwaway home, so
// ~/.claude is never touched), runs the bookkeeping commands and asserts on them.
// Usage: node scripts/selftest.js   (no agents, no network, a few seconds)
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const FACTORY = path.join(__dirname, 'factory.js')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-selftest-'))
const home = path.join(root, 'home')
const repo = path.join(root, 'app')
fs.mkdirSync(home)
fs.mkdirSync(repo)
const env = {
  ...process.env, HOME: home, USERPROFILE: home, FACTORY_NO_ORCA: '1', FACTORY_ROUTING: '',
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
}

function sh(cmd, args, cwd = repo) {
  const r = spawnSync(cmd, args, { cwd, env, encoding: 'utf8', windowsHide: true })
  return { code: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() }
}
function git(...args) {
  const r = sh('git', args)
  assert.strictEqual(r.code, 0, `git ${args.join(' ')}: ${r.err}`)
  return r.out
}
const F = (...args) => {
  const r = sh('node', [FACTORY, ...args])
  try { return JSON.parse(r.out) } catch { return { raw: r.out, err: r.err, code: r.code } }
}
const write = (f, t) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t) }
let passed = 0
const test = (name, fn) => { fn(); passed++; console.log(`ok - ${name}`) }

try {
  git('init', '-q', '-b', 'main')
  write(`${repo}/.gitignore`, '.env*\n!.env.example\n')
  write(`${repo}/.env.example`, 'KEY=\n')
  write(`${repo}/src/a.txt`, 'one\n')
  git('add', '.gitignore', '.env.example', 'src/a.txt')
  git('commit', '-qm', 'init')
  git('checkout', '-qb', 'dev')
  write(`${repo}/.env.local`, 'KEY=secret\n')
  write(`${repo}/notignored.txt`, 'x\n')
  git('config', 'factory.branch', 'feat/{id}')
  git('config', '--add', 'factory.copy', '.env*')
  git('config', '--add', 'factory.copy', 'notignored.txt')

  let job1, wt1
  test('setup uses the checked-out branch as base, not main', () => {
    const s = F('setup')
    assert.ok(s.ok, JSON.stringify(s))
    assert.strictEqual(s.base, 'dev')
    assert.ok(s.notices.some((n) => /agents/.test(n)), 'reports missing agents')
  })
  test('agents copies into ~/.claude/agents, then setup is quiet', () => {
    assert.strictEqual(F('agents').copied.length, fs.readdirSync(path.join(__dirname, '..', 'agents')).length)
    assert.ok(!F('setup').notices.some((n) => /agents/.test(n)))
  })
  test('new records the base', () => {
    const n = F('new', 'add a dark mode toggle')
    assert.ok(n.ok)
    assert.strictEqual(n.base, 'dev')
    job1 = n.id
  })
  test('worktree: branch template, env copied, non-ignored file refused', () => {
    const w = F('worktree', job1)
    assert.ok(w.ok, JSON.stringify(w))
    wt1 = w.worktree
    assert.strictEqual(w.branch, `feat/${job1}`)
    assert.deepStrictEqual(w.envCopied, ['.env.local'])
    assert.deepStrictEqual(w.envNotIgnored, ['notignored.txt'])
    assert.strictEqual(fs.readFileSync(`${wt1}/.env.local`, 'utf8'), 'KEY=secret\n')
    assert.strictEqual(sh('git', ['status', '--porcelain'], wt1).out, '', 'copied env leaves the worktree clean')
  })
  test('a second job gets its own branch and worktree', () => {
    const n = F('new', 'add csv export')
    const w = F('worktree', n.id)
    assert.notStrictEqual(w.worktree, wt1)
    assert.strictEqual(w.branch, `feat/${n.id}`)
  })
  test('worktree re-creates a removed worktree and copies env again', () => {
    git('worktree', 'remove', '--force', wt1)
    const w = F('worktree', job1)
    assert.ok(w.ok, JSON.stringify(w))
    assert.ok(fs.existsSync(`${wt1}/.env.local`))
  })
  test('keepspec copies the spec when factory.specdir is set', () => {
    write(`${repo}/.factory/jobs/${job1}/spec.md`, '# Dark mode\n\nSurface: ui\nSize: S\nRisk: low\n')
    assert.strictEqual(F('keepspec', job1).path, null)
    git('config', 'factory.specdir', 'docs/plan/feature')
    const k = F('keepspec', job1)
    assert.strictEqual(k.path, `docs/plan/feature/${job1}.md`)
    assert.ok(fs.existsSync(`${wt1}/${k.path}`))
    fs.rmSync(`${wt1}/docs`, { recursive: true })
  })
  test('round writes the diff and runs every reviewer in round 1', () => {
    write(`${wt1}/src/a.txt`, 'one\ntwo\n')
    assert.strictEqual(sh('git', ['commit', '-qam', 'change'], wt1).code, 0)
    const r = F('round', job1)
    assert.deepStrictEqual(r.run.sort(), ['code', 'security', 'ui', 'ux'])
    assert.match(fs.readFileSync(`${repo}/.factory/jobs/${job1}/round-1/diff.patch`, 'utf8'), /\+two/)
  })
  test('verdicts reads files with a BOM and lists CHANGES', () => {
    const d = `${repo}/.factory/jobs/${job1}/round-1`
    write(`${d}/review-security.md`, '﻿VERDICT: PASS\n')
    write(`${d}/review-ux.md`, 'VERDICT: PASS\r\n')
    write(`${d}/review-ui.md`, 'VERDICT: PASS\n')
    write(`${d}/review-code.md`, 'VERDICT: CHANGES\n')
    const v = F('verdicts', job1)
    assert.ok(v.done, JSON.stringify(v))
    assert.deepStrictEqual(v.changes, ['round-1/review-code.md'])
  })
  test('set keeps string fields strings and parses numbers', () => {
    F('set', job1, 'note=123', 'resumes=1')
    const j = JSON.parse(fs.readFileSync(`${repo}/.factory/jobs/${job1}/job.json`, 'utf8'))
    assert.strictEqual(j.note, '123')
    assert.strictEqual(j.resumes, 1)
  })
  test('round 2 re-runs only CHANGES + code and carries the rest', () => {
    write(`${wt1}/src/a.txt`, 'one\ntwo\nthree\n')
    sh('git', ['commit', '-qam', 'fix'], wt1)
    const r = F('round', job1)
    assert.deepStrictEqual(r.run, ['code'])
    assert.deepStrictEqual(r.carried.sort(), ['security', 'ui', 'ux'])
  })
  test('conflict: clean, then not clean when the base changes the same line', () => {
    assert.strictEqual(F('conflict', job1).clean, true)
    write(`${repo}/src/a.txt`, 'one\nTWO\n')
    git('commit', '-qam', 'base change')
    assert.strictEqual(F('conflict', job1).clean, false)
  })
  test('pr refuses a job that is not waiting for the human', () => {
    assert.strictEqual(F('pr', job1).error, 'wrong-stage')
  })
  test('pr pushes the branch and builds the body (gh fails on a non-GitHub remote)', () => {
    const d = `${repo}/.factory/jobs/${job1}`
    write(`${d}/build.md`, 'STATUS: READY\n\n# Build\n\n## Summary\nAdds the toggle.\n\n## Acceptance criteria\n1. [x] works\n\n## Log\nx\n')
    write(`${d}/decision.md`, 'APPROVE\n\n## Why\nAll good.\n')
    F('set', job1, 'stage=needs-human')
    sh('git', ['init', '-q', '--bare', path.join(root, 'remote.git')], root)
    git('remote', 'add', 'origin', path.join(root, 'remote.git'))
    const p = F('pr', job1)
    assert.strictEqual(p.error, 'gh-pr-failed', JSON.stringify(p))
    assert.strictEqual(sh('git', ['ls-remote', '--heads', 'origin', `feat/${job1}`]).out.length > 0, true, 'branch pushed')
    const body = fs.readFileSync(`${d}/pr-body.md`, 'utf8')
    assert.match(body, /## Summary\n\nAdds the toggle\./)
    assert.match(body, /1\. \[x\] works/)
    assert.match(body, /APPROVE: All good\./)
    assert.doesNotMatch(body, /## Log/)
  })
  test('claim takes over a stale backlog lock', () => {
    write(`${repo}/.factory/backlog.md`, '# Backlog\n\n- [ ] first item\n- [ ] second item\n')
    const lock = `${repo}/.factory/backlog.lock`
    fs.mkdirSync(lock)
    const old = new Date(Date.now() - 5 * 60e3)
    fs.utimesSync(lock, old, old)
    const c = F('claim', '1')
    assert.ok(c.ok, JSON.stringify(c))
    assert.deepStrictEqual(c.items, ['first item'])
    assert.ok(!fs.existsSync(lock))
  })
  test('quota survives a corrupt quota.json', () => {
    write(path.join(home, '.claude', 'factory', 'quota.json'), '{not json')
    const q = F('quota')
    assert.ok(q.ok)
    assert.strictEqual(q.available, false)
  })
  test('detached HEAD is refused', () => {
    git('config', '--unset', 'factory.branch')
    git('checkout', '-q', '--detach')
    assert.strictEqual(F('new', 'x').error, 'detached-head')
    git('checkout', '-q', 'dev')
  })
  console.log(`\n${passed} passed`)
} finally {
  sh('git', ['worktree', 'prune'])
  fs.rmSync(root, { recursive: true, force: true })
}
