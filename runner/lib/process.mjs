import { spawn } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import path from 'node:path'

export const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000

const SHELL_SAFE = /^[\w.:/\@=,+-]+$/
const SHELL_UNSAFE_PATH = /["%&^|<>]/
const live = new Set()

export function resolveExecutable(name, { env = process.env, platform = process.platform } = {}) {
  if (platform !== 'win32') return { file: name, shell: false }
  const extensions = path.extname(name) ? [''] : (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';')
  const dirs = (env.PATH ?? env.Path ?? '').split(';').map(dir => dir.replace(/^"|"$/g, '')).filter(Boolean)
  for (const dir of dirs) {
    for (const extension of extensions) {
      const file = path.join(dir, name + extension)
      if (existsSync(file) && statSync(file).isFile()) return { file, shell: /\.(cmd|bat)$/i.test(file) }
    }
  }
  throw new Error(`'${name}' was not found on PATH`)
}

// Node refuses to spawn .cmd/.bat without a shell, and a shell re-parses every argument,
// so only a fixed, plain-character argument list may go through one.
function assertShellSafe(command, file, args) {
  if (SHELL_UNSAFE_PATH.test(file)) throw new Error(`cannot run ${file} through a shell: unsafe characters in the path`)
  const index = args.findIndex(arg => !SHELL_SAFE.test(arg))
  if (index === -1) return
  const flag = args[index - 1]?.startsWith('--') ? args[index - 1] : args[index]
  throw new Error(`${command} resolves to ${file} (an npm .cmd shim) which cannot take the ${flag} argument safely; install the native ${command}.exe and put it first on PATH`)
}

export function assertLaunchable(command, args, resolve = resolveExecutable) {
  const { file, shell } = resolve(command)
  if (shell) assertShellSafe(command, file, args)
}

function killTree(child) {
  if (process.platform === 'win32') {
    spawn('taskkill', ['/T', '/F', '/PID', String(child.pid)], { stdio: 'ignore', windowsHide: true })
    return
  }
  try {
    process.kill(-child.pid, 'SIGKILL')
  } catch {
    // The group is already gone.
  }
}

export function killAll() {
  for (const child of live) killTree(child)
}

export async function runProcess({ command, args, input, cwd, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const { file, shell } = resolveExecutable(command)
  if (shell) assertShellSafe(command, file, args)
  return new Promise((resolve, reject) => {
    const child = spawn(shell ? `"${file}"` : file, args, {
      cwd,
      shell,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    live.add(child)
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      killTree(child)
    }, timeoutMs)

    child.stdout.setEncoding('utf8').on('data', chunk => (stdout += chunk))
    child.stderr.setEncoding('utf8').on('data', chunk => (stderr += chunk))
    // The child may exit before it has read all of its input.
    child.stdin.on('error', () => {})
    child.on('error', err => {
      clearTimeout(timer)
      live.delete(child)
      reject(new Error(`'${command}' could not be started: ${err.message}`))
    })
    child.on('close', code => {
      clearTimeout(timer)
      live.delete(child)
      resolve({ code, stdout, stderr, timedOut })
    })
    child.stdin.end(input)
  })
}
