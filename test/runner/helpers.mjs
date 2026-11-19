import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

export function write(cwd, file, content = 'x\n') {
  mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true })
  writeFileSync(path.join(cwd, file), content)
}

export function commit(cwd, file, content) {
  write(cwd, file, content)
  git(cwd, 'add', file)
  git(cwd, 'commit', '-m', `change ${file}`)
}

let template

function buildTemplate() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'qa-kit-template-'))
  process.on('exit', () => rmSync(root, { recursive: true, force: true }))
  const repo = path.join(root, 'repo')
  mkdirSync(repo)
  git(root, 'init', '--bare', '-b', 'main', 'origin.git')
  git(repo, 'init', '-b', 'main')
  write(repo, 'README.md')
  write(repo, 'src/user.ts')
  git(repo, 'add', '.')
  git(repo, 'commit', '-m', 'initial')
  git(repo, 'remote', 'add', 'origin', path.join(root, 'origin.git'))
  git(repo, 'push', '-u', 'origin', 'main')
  git(repo, 'remote', 'set-head', 'origin', 'main')
  return root
}

// A repo on `main` with one commit and its own local bare repository as origin, copied from a template built once per process.
export function makeRepo(t) {
  template ??= buildTemplate()
  const root = mkdtempSync(path.join(os.tmpdir(), 'qa-kit-test-'))
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 3 }))
  cpSync(template, root, { recursive: true })
  const repo = path.join(root, 'repo')
  git(repo, 'remote', 'set-url', 'origin', path.join(root, 'origin.git'))
  return repo
}

export function makeDir(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'qa-kit-test-'))
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 3 }))
  return dir
}
