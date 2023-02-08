import path from 'node:path'
import type { Plugin } from '../plugin'
import {
  CLIENT_ENTRY,
  DEFAULT_EXTENSIONS,
  DEFAULT_MAIN_FIELDS,
  DEP_VERSION_RE,
  ENV_ENTRY,
  FS_PREFIX,
  OPTIMIZABLE_ENTRY_RE,
  SPECIAL_QUERY_RE,
} from '../constants'
import { DepsOptimizer } from '../optimizer'
import {
  ensureVolumeInPath,
  fsPathFromId,
  isTsRequest,
  normalizePath,
} from '../utils'
import type { PartialResolvedId } from 'rollup'

const nodeModulesInPathRE = /(?:^|\/)node_modules\//

// 用浏览器标记的路径的特殊ID：false
// https://github.com/defunctzombie/package-browser-field-spec#ignore-a-module
export const browserExternalId = '__dpack-browser-external'
// special id for packages that are optional peer deps
export const optionalPeerDepId = '__dpack-optional-peer-dep'

export interface ResolveOptions {
  mainFields?: string[]
  conditions?: string[]
  extensions?: string[]
  dedupe?: string[]
  preserveSymlinks?: boolean
}

export interface InternalResolveOptions extends Required<ResolveOptions> {
  root: string
  isBuild: boolean
  isProduction: boolean
  // packageCache?: PackageCache
  /**
   * src code mode also attempts the following:
   * - resolving /xxx as URLs
   * - resolving bare imports from optimized deps
   */
  asSrc?: boolean
  tryIndex?: boolean
  tryPrefix?: string
  skipPackageJson?: boolean
  preferRelative?: boolean
  isRequire?: boolean
  // when the importer is a ts module,
  // if the specifier requests a non-existent `.js/jsx/mjs/cjs` file,
  // should also try import from `.ts/tsx/mts/cts` source file as fallback.
  isFromTsImporter?: boolean
  tryEsmOnly?: boolean
  // True when resolving during the scan phase to discover dependencies
  scan?: boolean
  // Resolve using esbuild deps optimization
  getDepsOptimizer?: () => DepsOptimizer | undefined
  shouldExternalize?: (id: string) => boolean | undefined
}

export function resolvePlugin(resolveOptions: InternalResolveOptions): Plugin {
  const { root, isProduction, asSrc, preferRelative = false } = resolveOptions

  return {
    name: 'dpack:resolve',

    async resolveId(id, importer, resolveOpt) {
      // 我们需要将depsOptimizer延迟到这里，而不是将它作为一个选项
      // 传递给resolvePlugin，因为优化器是在开发过程中在服务器上创建的。
      const depsOptimizer = resolveOptions.getDepsOptimizer?.()

      // TODO: 清除
      if (id.startsWith(browserExternalId)) {
        return id
      }

      const targetWeb = true

      const isRequire: boolean =
        resolveOpt?.custom?.['node-resolve']?.isRequire ?? false

      const options: InternalResolveOptions = {
        isRequire,
        ...resolveOptions,
        scan: resolveOpt?.scan ?? resolveOptions.scan,
      }

      if (importer) {
        // const _importer = isWorkerRequest(importer) TODO: worker
        const _importer = importer
        if (
          isTsRequest(_importer) ||
          resolveOpt.custom?.depScan?.loader?.startsWith('ts')
        ) {
          options.isFromTsImporter = true
        } else {
          const moduleLang = this.getModuleInfo(_importer)?.meta?.dpack?.lang
          options.isFromTsImporter = moduleLang && isTsRequest(`.${moduleLang}`)
        }
      }

      let res: string | PartialResolvedId | undefined

      // 解析预先捆绑的deps请求，这些可以通过
      // tryFileResolve或/fs/解决，但如果我们正在重新处理deps，
      // 这些文件可能还不存在。
      if (asSrc) {
        const optimizedPath = id.startsWith(FS_PREFIX)
          ? fsPathFromId(id)
          : normalizePath(ensureVolumeInPath(path.resolve(root, id.slice(1))))
        return optimizedPath
      }
    },
  }
}
