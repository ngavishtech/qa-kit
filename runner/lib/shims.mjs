export function makeRuntime({ adapter, log }) {
  // timeoutMs is optional and only ever shortens the run's own limit (see the adapters).
  async function agent(prompt, { agentType, phase, label, schema, timeoutMs }) {
    log(`${phase}: ${label} started`)
    try {
      const result = await adapter.run({ prompt, agentType, schema, label, timeoutMs })
      log(`${phase}: ${label} ${result ? 'finished' : 'returned nothing'}`)
      return result
    } catch (err) {
      log(`${phase}: ${label} failed - ${err.message}`)
      return null
    }
  }

  // A stage that throws blocks only its own item; the value keeps the fields earlier stages produced.
  async function pipeline(items, ...stages) {
    return Promise.all(
      items.map(async item => {
        let value = item
        for (const stage of stages) {
          try {
            value = await stage(value)
          } catch (err) {
            log(`${stage.name} threw: ${err.message}`)
            return { ...value, blocked: true, blockReason: `${stage.name} threw: ${err.message}` }
          }
        }
        return value
      }),
    )
  }

  async function parallel(tasks) {
    return Promise.all(
      tasks.map(async task => {
        try {
          return await task()
        } catch (err) {
          log(`task threw: ${err.message}`)
          return null
        }
      }),
    )
  }

  return { agent, pipeline, parallel, log }
}
