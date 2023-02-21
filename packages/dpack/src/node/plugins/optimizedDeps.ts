import { promises as fs } from 'node:fs'
import colors from 'picocolors'
import type { ResolvedConfig } from '..'
import type { Plugin } from '../plugin'
import { DEP_VERSION_RE } from '../constants'
import { cleanUrl } from '../utils'
import { getDepsOptimizer, optimizedDepInfoFromFile } from '../optimizer'

export const ERR_OPTIMIZE_DEPS_PROCESSING_ERROR =
  'ERR_OPTIMIZE_DEPS_PROCESSING_ERROR'
export const ERR_OUTDATED_OPTIMIZED_DEP = 'ERR_OUTDATED_OPTIMIZED_DEP'

export function optimizedDepsPlugin(config: ResolvedConfig): Plugin {
  const { logger } = config
  return {
    name: 'dpack:optimized-dep',

    async resolveId(id, source) {
      if (getDepsOptimizer(config)?.isOptimizedDepFile(id)) {
        return id
      }
    },

    // this.load({ id })在PluginContainer中没有实现。
    // 注册一个id以等待其被处理的逻辑在importAnalysis中，见对delayDepsOptimizerUntil的调用。

    async load(id) {
      const depsOptimizer = getDepsOptimizer(config)
      if (depsOptimizer?.isOptimizedDepFile(id)) {
        const metadata = depsOptimizer.metadata
        const file = cleanUrl(id)
        const versionMatch = id.match(DEP_VERSION_RE)
        const browserHash = versionMatch
          ? versionMatch[1].split('=')[1]
          : void 0

        // 在当前优化的和新发现的仓库中都进行搜索
        const info = optimizedDepInfoFromFile(metadata, file)
        if (info) {
          if (browserHash && info.browserHash !== browserHash) {
            throwOutdatedRequest(id)
          }
          try {
            await info.processing
          } catch {
            throwProcessingError(id)
            return
          }
          const newMetadata = depsOptimizer.metadata
          if (metadata !== newMetadata) {
            const currentInfo = optimizedDepInfoFromFile(newMetadata!, file)
            if (info.browserHash !== currentInfo?.browserHash) {
              throwOutdatedRequest(id)
            }
          }
        }
        logger.info(`load ${colors.cyan(file)}`)

        try {
          return await fs.readFile(file, 'utf-8')
        } catch (e) {
          throwOutdatedRequest(id)
        }
      }
    },
  }
}

function throwProcessingError(id: string): never {
  const err: any = new Error(
    `Something unexpected happened while optimizing "${id}". ` +
      `The current page should have reloaded by now`,
  )
  err.code = ERR_OPTIMIZE_DEPS_PROCESSING_ERROR
  // This error will be caught by the transform middleware that will
  // send a 504 status code request timeout
  throw err
}

export function throwOutdatedRequest(id: string): never {
  const err: any = new Error(
    `There is a new version of the pre-bundle for "${id}", ` +
      `a page reload is going to ask for it.`,
  )
  err.code = ERR_OUTDATED_OPTIMIZED_DEP
  // 这个错误将被转换中间件捕获，它将发送504状态代码请求超时
  throw err
}
