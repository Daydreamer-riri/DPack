import { join, dirname } from 'node:path'
import fs from 'node:fs'
import { isFileReadable } from '../utils'

function hasWorkspacePackageJSON(root: string): boolean {
  const path = join(root, 'package.json')
  if (!isFileReadable(path)) {
    return false
  }
  const content = JSON.parse(fs.readFileSync(path, 'utf-8')) || {}
  return !!content.workspaces
}

function hasPackageJSON(root: string) {
  const path = join(root, 'package.json')
  return fs.existsSync(path)
}

/**
 * 向上搜索最近的`package.json`
 */
export function searchForPackageRoot(current: string, root = current): string {
  if (hasPackageJSON(current)) return current

  const dir = dirname(current)
  // reach the fs root
  if (!dir || dir === current) return root

  return searchForPackageRoot(dir, root)
}

/**
 * 向上搜索最近的工作区根
 */
export function searchForWorkspaceRoot(
  current: string,
  root = searchForPackageRoot(current),
): string {
  // if (hasRootFile(current)) return current
  if (hasWorkspacePackageJSON(current)) return current

  const dir = dirname(current)
  // reach the fs root
  if (!dir || dir === current) return root

  return searchForWorkspaceRoot(dir, root)
}
