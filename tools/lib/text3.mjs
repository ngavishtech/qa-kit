// Text three-way merge and diff, delegated to git (always present where qa-kit runs).
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const normalizeEol = (s) => s.replace(/\r\n/g, '\n')

function git(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (r.error) throw new Error(`git is required but could not be run: ${r.error.message}`)
  return r
}

function withTempFiles(files, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'qa-kit-'))
  try {
    for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content)
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// Returns { text, conflicts }; conflicts > 0 means `text` contains conflict markers.
export function merge3Text(base, ours, theirs) {
  return withTempFiles({ ours, base, theirs }, (dir) => {
    const r = git(['merge-file', '-p', '-L', 'repo', '-L', 'kit-previous', '-L', 'kit-new', 'ours', 'base', 'theirs'], dir)
    if (r.status === null || r.status > 127) throw new Error(`git merge-file failed: ${r.stderr.trim()}`)
    return { text: r.stdout, conflicts: r.status }
  })
}

export function unifiedDiff(before, after, label) {
  if (before === after) return ''
  return withTempFiles({ before, after }, (dir) => {
    const r = git(['diff', '--no-index', '--no-color', '--', 'before', 'after'], dir)
    if (r.status !== 0 && r.status !== 1) throw new Error(`git diff failed: ${r.stderr.trim()}`)
    return r.stdout.replaceAll('a/before', `a/${label}`).replaceAll('b/after', `b/${label}`)
  })
}
