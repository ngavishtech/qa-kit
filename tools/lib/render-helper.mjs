// Layer 2 of merge.mjs resolveBase: renders every template with the renderer shipped in an OLD kit tag.
// Runs in its own process, only after the user agreed (the code comes from a clone of the kit repository),
// with an empty working folder, so no repo file is read or written. Prints { [target]: text } as JSON.
//   node render-helper.mjs <cloneDir> <varsJsonFile> <agentsCsv> <emptyDir>
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const [, , cloneDir, varsFile, agentsCsv, emptyDir] = process.argv
const vars = JSON.parse(readFileSync(varsFile, 'utf8'))
const agents = agentsCsv.split(',')
const mod = await import(pathToFileURL(join(cloneDir, 'tools', 'merge.mjs')).href)

let out
if (typeof mod.renderAll === 'function') {
  out = mod.renderAll({ kitRoot: cloneDir, agents, vars })
} else if (typeof mod.plan === 'function') {
  // Kits that predate renderAll: their plan() on an empty folder renders every file as `theirs`.
  out = Object.fromEntries(mod.plan({ repo: emptyDir, kitRoot: cloneDir, agents, vars }).entries.map((e) => [e.target, e.theirs]))
} else {
  throw new Error('the kit in this tag exports neither renderAll nor plan')
}
process.stdout.write(JSON.stringify(out))
