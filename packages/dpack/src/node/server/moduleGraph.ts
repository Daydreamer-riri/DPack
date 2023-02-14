import { extname } from 'node:path'
import type { ModuleInfo, PartialResolvedId } from 'rollup'
import { FS_PREFIX } from '../constants'
import type { TransformResult } from './transformRequest'
import { isDirectCSSRequest } from '../plugins/css'
import { cleanUrl, removeImportQuery, removeTimestampQuery } from '../utils'

export class ModuleNode {
  url: string
  id: string | null = null
  file: string | null = null
  type: 'js' | 'css'
  info?: ModuleInfo
  meta?: Record<string, any>
  importers = new Set<ModuleNode>()
  acceptedHmrDeps = new Set<ModuleNode>()
  acceptedHmrExports: Set<string> | null = null
  importedBindings: Map<string, Set<string>> | null = null
  isSelfAccepting?: boolean
  transformResult: TransformResult | null = null
  lastHMRTimestamp = 0
  lastInvalidationTimestamp = 0

  constructor(url: string, setIsSelfAccepting = true) {
    this.url = url
    this.type = isDirectCSSRequest(url) ? 'css' : 'js'
    if (setIsSelfAccepting) {
      this.isSelfAccepting = false
    }
  }
}

export type ResolveUrl = [
  url: string,
  resolvedId: string,
  meta: object | null | undefined,
]

export class ModuleGraph {
  urlToModuleMap = new Map<string, ModuleNode>()
  idToModuleMap = new Map<string, ModuleNode>()
  fileToModulesMap = new Map<string, Set<ModuleNode>>()
  selfModulesPath = new Set<string>()

  constructor(
    private resolveId: (url: string) => Promise<PartialResolvedId | null>,
  ) {}

  async getModuleByUrl(rawUrl: string): Promise<ModuleNode | undefined> {
    const [url] = await this.resolveUrl(rawUrl)
    return this.urlToModuleMap.get(url)
  }

  getModuleById(id: string): ModuleNode | undefined {
    return this.idToModuleMap.get(removeTimestampQuery(id))
  }

  async ensureEntryFromUrl(
    rawUrl: string,
    setIsSelfAccepting = true,
  ): Promise<ModuleNode> {
    const [url, resolvedId, meta] = await this.resolveUrl(rawUrl)
    let mod = this.idToModuleMap.get(resolvedId)
    if (!mod) {
      mod = new ModuleNode(url, setIsSelfAccepting)
      if (meta) mod.meta = meta
      this.urlToModuleMap.set(url, mod)
      mod.id = resolvedId
      this.idToModuleMap.set(resolvedId, mod)
      const file = (mod.file = cleanUrl(resolvedId))
      let fileMappedModules = this.fileToModulesMap.get(file)
      if (!fileMappedModules) {
        fileMappedModules = new Set()
        this.fileToModulesMap.set(file, fileMappedModules)
      }
      fileMappedModules.add(mod)
    }
    // 多个URL可以映射到相同的模块和ID，请确保我们将URL注册到现有的模块中。
    // 在这种情况下，确保我们将url注册到现有的模块上
    else if (!this.urlToModuleMap.has(url)) {
      this.urlToModuleMap.set(url, mod)
    }
    return mod
  }

  async resolveUrl(url: string): Promise<ResolveUrl> {
    url = removeImportQuery(removeTimestampQuery(url))
    const resolved = await this.resolveId(url)
    const resolvedId = resolved?.id || url
    if (
      url !== resolvedId &&
      !url.includes('\0') &&
      !url.startsWith(`virtual:`)
    ) {
      const ext = extname(cleanUrl(resolvedId))
      const { pathname, search, hash } = new URL(url, 'relative://')
      if (ext && !pathname.endsWith(ext)) {
        url = pathname + ext + search + hash
      }
    }
    return [url, resolvedId, resolved?.meta]
  }
}
