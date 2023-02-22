import { isMatch } from 'picomatch'
import type { DpackDevServer } from '../server'
import type { ModuleNode } from '../server/moduleGraph'

export function getAffectedGlobModules(
  file: string,
  server: DpackDevServer,
): ModuleNode[] {
  const modules: ModuleNode[] = []
  for (const [id, allGlobs] of server._importGlobMap) {
    if (allGlobs.some((glob) => isMatch(file, glob)))
      modules.push(...(server.moduleGraph.getModulesByFile(id) || []))
  }
  modules.forEach((i) => {
    if (i?.file) server.moduleGraph.onFileChange(i.file)
  })
  return modules
}
