import { DEFAULT_TIMEOUT_MS, assertLaunchable, resolveExecutable, runProcess } from '../process.mjs'

export const agentPrefix = 'qa-kit:'

const ALWAYS_DENIED = [
  'Bash(git add -A*)',
  'Bash(git add .*)',
  'Bash(git commit*--no-verify*)',
  'Bash(git push*--force*)',
  'Bash(git push* -f*)',
]

// Headless runs cannot answer prompts, so delivery needs these pre-approved; commit, push and PR only when the run authorized them.
const DELIVERY_ALLOWED = [
  'Bash(git add *)',
  'Bash(git checkout *)',
  'Bash(git switch *)',
  'Bash(git fetch*)',
  'Bash(git worktree add *)',
  'Bash(git pull --ff-only*)',
]

// The change flows (feature-select, feature-diff) only read: none of the delivery commands is pre-approved, and a fetch only when the run
// was started with --fetch. Everything that changes git state is denied outright.
const READ_ONLY_DENIED = ['Bash(git add*)', 'Bash(git commit*)', 'Bash(git checkout*)', 'Bash(git switch*)', 'Bash(git worktree*)', 'Bash(git pull*)', 'Bash(git push*)', 'Bash(git stash*)', 'Bash(git reset*)', 'Bash(git clean*)', 'Bash(git restore*)', 'Bash(git branch -d*)', 'Bash(git branch -D*)', 'Bash(git branch -m*)', 'Bash(git branch -M*)', 'Bash(git branch -c*)', 'Bash(git branch -C*)', 'Bash(git branch -f*)', 'Bash(git branch --delete*)', 'Bash(git branch --move*)', 'Bash(git branch --copy*)', 'Bash(git branch --force*)', 'Bash(git branch --set-upstream*)', 'Bash(git tag*)', 'Bash(git merge*)', 'Bash(git rebase*)', 'Bash(gh pr create*)', 'Bash(gh api*)']

export function toolRules({ commit, push, pr }, { strict = false, allowFetch = false } = {}) {
  if (strict) return { allow: allowFetch ? ['Bash(git fetch origin *)'] : [], deny: [...ALWAYS_DENIED, ...READ_ONLY_DENIED, ...(allowFetch ? [] : ['Bash(git fetch*)'])] }
  return {
    allow: [...DELIVERY_ALLOWED, ...(commit ? ['Bash(git commit *)'] : []), ...(push ? ['Bash(git push*)'] : []), ...(pr ? ['Bash(gh pr create*)'] : [])],
    deny: [...ALWAYS_DENIED, ...(commit ? [] : ['Bash(git commit*)']), ...(push ? [] : ['Bash(git push*)']), ...(pr ? [] : ['Bash(gh pr create*)'])],
  }
}

function structuredOutput(result) {
  if (result.timedOut) return { problem: 'timed out' }
  let output
  try {
    output = JSON.parse(result.stdout)
  } catch {
    const detail = result.stderr ? `: ${result.stderr.trim().slice(-300)}` : ''
    return { problem: `claude exited ${result.code} without JSON output${detail}` }
  }
  const value = output.structured_output
  if (output.is_error || typeof value !== 'object' || value === null) {
    return { problem: `claude returned no structured result (${output.subtype ?? 'unknown'})` }
  }
  return { value }
}

function buildArgs({ agentType, schema, model, rules }) {
  return [
    '-p',
    '--output-format', 'json',
    '--agent', agentType,
    '--json-schema', JSON.stringify(schema),
    '--permission-mode', 'acceptEdits',
    '--permission-prompts', 'none',
    '--allowedTools', rules.allow.join(','),
    '--disallowedTools', rules.deny.join(','),
    ...(model ? ['--model', model] : []),
  ]
}

export function createAdapter({ model, cwd, policy, readOnly, timeoutMs = DEFAULT_TIMEOUT_MS, log = () => {}, exec = runProcess, resolve = resolveExecutable }) {
  const rules = toolRules(policy, readOnly ?? {})
  return {
    agentPrefix,
    preflight() {
      assertLaunchable('claude', buildArgs({ agentType: `${agentPrefix}agent-planner`, schema: {}, model, rules }), resolve)
    },
    async run({ prompt, agentType, schema, label, timeoutMs: callTimeoutMs }) {
      const args = buildArgs({ agentType, schema, model, rules })
      try {
        const result = await exec({ command: 'claude', args, input: prompt, cwd, timeoutMs: Math.min(callTimeoutMs ?? Infinity, timeoutMs) })
        const { value, problem } = structuredOutput(result)
        if (problem) log(`${label}: ${problem}`)
        return value ?? null
      } catch (err) {
        log(`${label}: ${err.message}`)
        return null
      }
    },
  }
}
