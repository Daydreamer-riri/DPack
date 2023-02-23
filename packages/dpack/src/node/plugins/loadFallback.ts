import { promises as fs } from 'node:fs'
import type { Plugin } from '..'
import { cleanUrl } from '../utils'

/**
 * 一个插件，为带有查询的任意请求提供构建加载回退。
 */
export function loadFallbackPlugin(): Plugin {
  return {
    name: 'dpack:load-fallback',
    async load(id) {
      try {
        return await fs.readFile(cleanUrl(id), 'utf-8')
      } catch (e) {
        return fs.readFile(id, 'utf-8')
      }
    },
  }
}
