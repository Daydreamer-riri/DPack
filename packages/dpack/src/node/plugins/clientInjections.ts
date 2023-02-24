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

      const resolvedServerHostname = (await resolveHostname(config.server.base))
        .name
      const resolvedServerPort = config.server.port!
      const devBase = config.base

      const serverHost = `${resolvedServerHostname}:${resolvedServerPort}${devBase}`

      let hmrConfig = config.server.hmr
      hmrConfig = isObject(hmrConfig) ? hmrConfig : void 0
      const host = hmrConfig?.host || null
      const protocol = hmrConfig?.protocol || null
      const timeout = hmrConfig?.timeout || 30000
      const overlay = hmrConfig?.overlay !== false

      let port = hmrConfig?.clientPort || hmrConfig?.port || null
      if (config.server.middlewareMode) {
        port ||= 24678
      }

      let directTarget = hmrConfig?.host || resolvedServerHostname
      directTarget += `:${hmrConfig?.port || resolvedServerPort}`
      directTarget += devBase

      let hmrBase = devBase
      if (hmrConfig?.path) {
        hmrBase = path.posix.join(hmrBase, hmrConfig.path)
      }

      return code
        .replace('__MODE__', JSON.stringify(config.mode))
        .replace(/__BASE__/g, JSON.stringify(devBase))
        .replace('__DEFINES__', serializeDefine(config.define || {}))
        .replace('__SERVER_HOST__', JSON.stringify(serverHost))
        .replace('__HMR_PROTOCOL__', JSON.stringify(protocol))
        .replace('__HMR_HOSTNAME__', JSON.stringify(host))
        .replace('__HMR_PORT__', JSON.stringify(port))
        .replace('__HMR_DIRECT_TARGET__', JSON.stringify(directTarget))
        .replace('__HMR_BASE__', JSON.stringify(hmrBase))
        .replace('__HMR_TIMEOUT__', JSON.stringify(timeout))
        .replace(`__HMR_ENABLE_OVERLAY__`, JSON.stringify(overlay))
    },
  }
}

function serializeDefine(define: Record<string, any>): string {
  let res = `{`
  for (const key in define) {
    const val = define[key]
    res += `${JSON.stringify(key)}: ${
      typeof val === 'string' ? `(${val})` : JSON.stringify(val)
    } `
  }
  return res + `}`
}
