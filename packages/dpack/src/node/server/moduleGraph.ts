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

  constructor(url: string) {
    this.url = url
    this.type = isDirectCSSRequest(url) ? 'css' : 'js'
    this.isSelfAccepting = false
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
