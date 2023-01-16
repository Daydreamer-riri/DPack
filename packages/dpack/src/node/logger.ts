import readline from 'node:readline'
import colors from 'picocolors'
import type { RollupError } from 'rollup'

export type LogType = 'error' | 'worn' | 'info'
export type LogLevel = LogType | 'silent'
