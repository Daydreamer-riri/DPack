// simple-vite/vit/index.js
import path from 'node:path'
import fs from 'node:fs'
import { init, parse } from 'es-module-lexer'
import MagicString from 'magic-string'
import type { ResolvedConfig } from '../config'
import type { Plugin } from '../plugin'

export function importAnalysisPlugin(config: ResolvedConfig) {
  const { cacheDir } = config

  return {
    name: 'dpack:import-analysis',
    async transform(code: string, id?: string) {
      // es-module-lexer 的 init 必须在 parse 前 Resolve
      await init
      // 通过 es-module-lexer 分析源 code 中所有的 import 语句
      const [imports] = parse(code)
      // 如果没有 import 语句我们直接返回源 code
      if (!imports || !imports.length) return code
      // 定义依赖映射的对象
      const metaData = JSON.parse(
        fs.readFileSync(path.join(cacheDir, '_metadata.json'), 'utf-8'),
      )
      // magic-string 主要适用于将源代码中的某些轻微修改或者替换
      let transformCode = new MagicString(code)
      imports.forEach((importer) => {
        // n： 表示模块的名称 如 vue
        // s: 模块名称在导入语句中的起始位置
        // e: 模块名称在导入语句中的结束位置
        const { n, s, e } = importer
        // 得到模块对应预构建后的真实路径  如
        const replacePath = metaData[n!] || n
        // 将模块名称替换成真实路径如/node_modules/.dpack
        transformCode = transformCode.overwrite(s, e, replacePath)
      })
      return transformCode.toString()
    },
  }
}
