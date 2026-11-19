const TYPE_CHECKS = {
  object: value => typeof value === 'object' && value !== null && !Array.isArray(value),
  array: Array.isArray,
  string: value => typeof value === 'string',
  boolean: value => typeof value === 'boolean',
}

export function validate(value, schema, path = '$') {
  if (schema.type && !TYPE_CHECKS[schema.type](value)) return [`${path} must be ${schema.type}`]
  const errors = []
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path} must be one of ${schema.enum.join(', ')}`)
  if (schema.type === 'object') {
    for (const key of schema.required ?? []) {
      if (!(key in value)) errors.push(`${path}.${key} is required`)
    }
    for (const [key, sub] of Object.entries(schema.properties ?? {})) {
      if (key in value) errors.push(...validate(value[key], sub, `${path}.${key}`))
    }
  }
  if (schema.type === 'array' && schema.items) {
    value.forEach((item, i) => errors.push(...validate(item, schema.items, `${path}[${i}]`)))
  }
  return errors
}
