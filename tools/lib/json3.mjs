// Three-way merge for JSON config files (settings.json, .mcp.json, opencode.json).
// base = what the kit wrote last time, ours = the file in the repo, theirs = what the new kit renders.

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const isScalarArray = (v) => Array.isArray(v) && v.every((x) => x === null || typeof x !== 'object')

// Command lines are order-sensitive: merging them as sets can fuse two versions of a package into one broken argv.
const ORDERED_KEYS = /\/(args|command)$/

export function deepEqual(a, b) {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]))
  }
  if (isObject(a) && isObject(b)) {
    const keys = Object.keys(a)
    return keys.length === Object.keys(b).length && keys.every((k) => k in b && deepEqual(a[k], b[k]))
  }
  return false
}

function walk(base, ours, theirs, path, conflicts, details) {
  if (deepEqual(ours, theirs)) return ours
  if (deepEqual(ours, base)) return theirs
  if (deepEqual(theirs, base)) return ours

  if (isObject(ours) && isObject(theirs)) {
    const b = isObject(base) ? base : {}
    const out = {}
    const keys = [...Object.keys(ours), ...Object.keys(theirs).filter((k) => !(k in ours))]
    for (const key of keys) {
      const v = walk(b[key], ours[key], theirs[key], `${path}/${key}`, conflicts, details)
      if (v !== undefined) out[key] = v
    }
    return out
  }

  if (!ORDERED_KEYS.test(path) && isScalarArray(ours) && isScalarArray(theirs) && (base === undefined || isScalarArray(base))) {
    // Treat as a set: keep local additions, take the kit's additions, drop what the kit removed.
    const b = base ?? []
    const removedByKit = new Set(b.filter((x) => !theirs.includes(x)))
    const addedByKit = theirs.filter((x) => !b.includes(x) && !ours.includes(x))
    return [...ours.filter((x) => !removedByKit.has(x)), ...addedByKit]
  }

  conflicts.push(path || '/')
  details.push({ path: path || '/', ours, theirs })
  return ours
}

// base may be undefined when the previous kit output is unknown; everything the kit now ships is then
// added and any key whose value differs is reported as a conflict.
export function merge3(base, ours, theirs) {
  const conflicts = []
  const details = []
  const value = walk(base, ours, theirs, '', conflicts, details)
  return { value, conflicts, details }
}
