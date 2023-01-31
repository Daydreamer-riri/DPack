import type { Server } from 'node:http'

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

// export function updateModules(
//   file: string,
//   modules: ModuleNode[],
//   timestamp: number,
//   { config, ws }: ViteDevServer,
//   afterInvalidation?: boolean,
// ): void {
//   const updates: Update[] = []
//   const invalidatedModules = new Set<ModuleNode>()
//   let needFullReload = false

//   for (const mod of modules) {
//     invalidate(mod, timestamp, invalidatedModules)
//     if (needFullReload) {
//       continue
//     }

//     const boundaries = new Set<{
//       boundary: ModuleNode
//       acceptedVia: ModuleNode
//     }>()
//     const hasDeadEnd = propagateUpdate(mod, boundaries)
//     if (hasDeadEnd) {
//       needFullReload = true
//       continue
//     }

//     updates.push(
//       ...[...boundaries].map(({ boundary, acceptedVia }) => ({
//         type: `${boundary.type}-update` as const,
//         timestamp,
//         path: normalizeHmrUrl(boundary.url),
//         explicitImportRequired:
//           boundary.type === 'js'
//             ? isExplicitImportRequired(acceptedVia.url)
//             : undefined,
//         acceptedPath: normalizeHmrUrl(acceptedVia.url),
//       })),
//     )
//   }

//   if (needFullReload) {
//     config.logger.info(colors.green(`page reload `) + colors.dim(file), {
//       clear: !afterInvalidation,
//       timestamp: true,
//     })
//     ws.send({
//       type: 'full-reload',
//     })
//     return
//   }

//   if (updates.length === 0) {
//     debugHmr(colors.yellow(`no update happened `) + colors.dim(file))
//     return
//   }

//   config.logger.info(
//     colors.green(`hmr update `) +
//       colors.dim([...new Set(updates.map((u) => u.path))].join(', ')),
//     { clear: !afterInvalidation, timestamp: true },
//   )
//   ws.send({
//     type: 'update',
//     updates,
//   })
// }
