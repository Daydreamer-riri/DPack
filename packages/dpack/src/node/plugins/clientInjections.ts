import path from 'node:path'
import type { Plugin, ResolvedConfig } from '..'
import { CLIENT_ENTRY, ENV_ENTRY } from '../constants'
import { isObject, normalizePath, resolveHostname } from '../utils'

const normalizedClientEntry = normalizePath(CLIENT_ENTRY)
const normalizedEnvEntry = normalizePath(ENV_ENTRY)

export function clientInjectionsPlugin(config: ResolvedConfig): Plugin {
  return {
    name: 'dpack:client-inject',
    async transform(code, id) {
      if (!(id === normalizedClientEntry || id === normalizedEnvEntry)) {
        if (code.includes('process.env.NODE_ENV')) {
          return code.replace(
            /\bprocess\.env\.NODE_ENV\b/g,
            config.define?.['process.env.NODE_ENV'] ||
              JSON.stringify(process.env.NODE_ENV || config.mode),
          )
        }
        return
      }

      // const resolve
    },
  }
}
