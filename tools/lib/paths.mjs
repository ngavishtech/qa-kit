import { homedir } from 'node:os'
import { join } from 'node:path'

export const defaultConfigDir = () => join(homedir(), '.config', 'opencode')
