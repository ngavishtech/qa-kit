import { execFileSync } from 'node:child_process'

// Prompts would hang an unattended run, so stdin is closed and git never asks for credentials.
function run(file, cwd, args, timeout) {
  try {
    return execFileSync(file, args, {
      cwd,
      timeout,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 1 << 28,
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    }).trimEnd()
  } catch {
    return null
  }
}

export const tryGit = (cwd, args, timeout) => run('git', cwd, args, timeout)
export const tryGh = (cwd, args, timeout) => run('gh', cwd, args, timeout)
