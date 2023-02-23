import path from 'node:path'
import type { Server } from 'node:http'
import colors from 'picocolors'
import type { Update } from 'types/hmrPayload'
import type { DpackDevServer } from '.'
import { isCSSRequest } from '../plugins/css'
import { isExplicitImportRequired } from '../plugins/importAnalysis'
import { getAffectedGlobModules } from '../plugins/importMetaGlob'
import { createDebugger, wrapId } from '../utils'
import type { ModuleNode } from './moduleGraph'

export const debugHmr = createDebugger('dpack:hmr')

export interface HmrOptions {
  protocol?: string
  host?: string
  port?: number
  clientPort?: number
  path?: string
  timeout?: number
  overlay?: boolean
  server?: Server
}

export function getShortName(file: string, root: string): string {
  return file.startsWith(root + '/') ? path.posix.relative(root, file) : file
}

export function updateModules(
  file: string,
  modules: ModuleNode[],
  timestamp: number,
  server: DpackDevServer,
  afterInvalidation?: boolean,
): void {
  const { config, ws } = server
  const updates: Update[] = []
  const invalidatedModules = new Set<ModuleNode>()
  // let needFullReload = false // 暂时先做全刷新
  let needFullReload = true

  for (const mod of modules) {
    invalidate(mod, timestamp, invalidatedModules)
    if (needFullReload) {
      continue
    }

    const boundaries = new Set<{
      boundary: ModuleNode
      acceptedVia: ModuleNode
    }>()
    // TODO: 局部更新相关
    const hasDeadEnd = propagateUpdate(mod, boundaries)
    if (hasDeadEnd) {
      needFullReload = true
      continue
    }

    updates.push(
      ...[...boundaries].map(({ boundary, acceptedVia }) => ({
        type: `${boundary.type}-update` as const,
        timestamp,
        path: normalizeHmrUrl(boundary.url),
        explicitImportRequired:
          boundary.type === 'js'
            ? isExplicitImportRequired(acceptedVia.url)
            : undefined,
        acceptedPath: normalizeHmrUrl(acceptedVia.url),
      })),
    )
  }

  if (needFullReload) {
    config.logger.info(colors.green(`page reload `) + colors.dim(file), {
      clear: !afterInvalidation,
      timestamp: true,
    })
    ws.send({
      type: 'full-reload',
    })
    return
  }

  if (updates.length === 0) {
    debugHmr(colors.yellow(`no update happened `) + colors.dim(file))
    return
  }

  config.logger.info(
    colors.green(`hmr update `) +
      colors.dim([...new Set(updates.map((u) => u.path))].join(', ')),
    { clear: !afterInvalidation, timestamp: true },
  )
  ws.send({
    type: 'update',
    updates,
  })
}

export async function handleFileAddUnlink(
  file: string,
  server: DpackDevServer,
) {
  const modules = [...(server.moduleGraph.getModulesByFile(file) || [])]

  modules.push(...getAffectedGlobModules(file, server))

  if (modules.length > 0) {
  }
}

function propagateUpdate(
  node: ModuleNode,
  boundaries: Set<{ boundary: ModuleNode; acceptedVia: ModuleNode }>,
  currentChain: ModuleNode[] = [node],
) /* hasDeadEnd */ {
  if (node.id && node.isSelfAccepting === void 0) {
    debugHmr(
      `[propagate update] stop propagation because not analyzed: ${colors.dim(
        node.id,
      )}`,
    )
    return false
  }

  if (node.isSelfAccepting) {
    boundaries.add({
      boundary: node,
      acceptedVia: node,
    })

    // additionally check for CSS importers
    for (const importer of node.importers) {
      if (isCSSRequest(importer.url) && !currentChain.includes(importer)) {
        propagateUpdate(importer, boundaries, currentChain.concat(importer))
      }
    }

    return false
  }

  if (node.acceptedHmrExports) {
    boundaries.add({
      boundary: node,
      acceptedVia: node,
    })
  } else {
    if (!node.importers.size) {
      return true
    }
  }

  for (const importer of node.importers) {
    const subChain = currentChain.concat(importer)
    if (importer.acceptedHmrDeps.has(node)) {
      boundaries.add({
        boundary: importer,
        acceptedVia: node,
      })
      continue
    }

    if (node.id && node.acceptedHmrExports && importer.importedBindings) {
      // TODO:...
    }
  }
}

function invalidate(mod: ModuleNode, timestamp: number, seen: Set<ModuleNode>) {
  if (seen.has(mod)) return
  seen.add(mod)
  mod.lastHMRTimestamp = timestamp
  mod.transformResult = null
  mod.importers.forEach((importer) => {
    if (!importer.acceptedHmrDeps.has(mod)) {
      invalidate(importer, timestamp, seen)
    }
  })
}

export function normalizeHmrUrl(url: string) {
  if (!url.startsWith('.') && !url.startsWith('/')) {
    url = wrapId(url)
  }
  return url
}
