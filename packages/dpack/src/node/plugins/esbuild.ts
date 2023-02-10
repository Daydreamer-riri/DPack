import { TransformOptions } from 'esbuild'

export interface ESBuildOptions extends TransformOptions {
  include?: string | RegExp | string[] | RegExp[]
  exclude?: string | RegExp | string[] | RegExp[]
  jsxInject?: string
}

// export async function transformWithEsbuild(
//   code: string,
//   filename: string,
//   options?: TransformOptions,
//   inMap?: object,
// ): Promise<ESBuildTransformResult> {
//   let loader = options?.loader

//   if (!loader) {
//     // if the id ends with a valid ext, use it (e.g. vue blocks)
//     // otherwise, cleanup the query before checking the ext
//     const ext = path
//       .extname(/\.\w+$/.test(filename) ? filename : cleanUrl(filename))
//       .slice(1)

//     if (ext === 'cjs' || ext === 'mjs') {
//       loader = 'js'
//     } else if (ext === 'cts' || ext === 'mts') {
//       loader = 'ts'
//     } else {
//       loader = ext as Loader
//     }
//   }

//   let tsconfigRaw = options?.tsconfigRaw

//   // if options provide tsconfigRaw in string, it takes highest precedence
//   if (typeof tsconfigRaw !== 'string') {
//     // these fields would affect the compilation result
//     // https://esbuild.github.io/content-types/#tsconfig-json
//     const meaningfulFields: Array<keyof TSCompilerOptions> = [
//       'alwaysStrict',
//       'importsNotUsedAsValues',
//       'jsx',
//       'jsxFactory',
//       'jsxFragmentFactory',
//       'jsxImportSource',
//       'preserveValueImports',
//       'target',
//       'useDefineForClassFields',
//     ]
//     const compilerOptionsForFile: TSCompilerOptions = {}
//     if (loader === 'ts' || loader === 'tsx') {
//       const loadedTsconfig = await loadTsconfigJsonForFile(filename)
//       const loadedCompilerOptions = loadedTsconfig.compilerOptions ?? {}

//       for (const field of meaningfulFields) {
//         if (field in loadedCompilerOptions) {
//           // @ts-expect-error TypeScript can't tell they are of the same type
//           compilerOptionsForFile[field] = loadedCompilerOptions[field]
//         }
//       }
//     }

//     tsconfigRaw = {
//       ...tsconfigRaw,
//       compilerOptions: {
//         ...compilerOptionsForFile,
//         ...tsconfigRaw?.compilerOptions,
//       },
//     }

//     const { compilerOptions } = tsconfigRaw
//     if (compilerOptions) {
//       // esbuild derives `useDefineForClassFields` from `target` instead of `tsconfig.compilerOptions.target`
//       // https://github.com/evanw/esbuild/issues/2584
//       // but we want `useDefineForClassFields` to be derived from `tsconfig.compilerOptions.target`
//       if (compilerOptions.useDefineForClassFields === undefined) {
//         const lowercaseTarget = compilerOptions.target?.toLowerCase() ?? 'es3'
//         if (lowercaseTarget.startsWith('es')) {
//           const esVersion = lowercaseTarget.slice(2)
//           compilerOptions.useDefineForClassFields =
//             esVersion === 'next' || +esVersion >= 2022
//         } else {
//           compilerOptions.useDefineForClassFields = false
//         }
//       }
//     }
//   }

//   const resolvedOptions = {
//     sourcemap: true,
//     // ensure source file name contains full query
//     sourcefile: filename,
//     ...options,
//     loader,
//     tsconfigRaw,
//   } as ESBuildOptions

//   // esbuild uses tsconfig fields when both the normal options and tsconfig was set
//   // but we want to prioritize the normal options
//   if (
//     options &&
//     typeof resolvedOptions.tsconfigRaw === 'object' &&
//     resolvedOptions.tsconfigRaw.compilerOptions
//   ) {
//     options.jsx && (resolvedOptions.tsconfigRaw.compilerOptions.jsx = undefined)
//     options.jsxFactory &&
//       (resolvedOptions.tsconfigRaw.compilerOptions.jsxFactory = undefined)
//     options.jsxFragment &&
//       (resolvedOptions.tsconfigRaw.compilerOptions.jsxFragmentFactory =
//         undefined)
//     options.jsxImportSource &&
//       (resolvedOptions.tsconfigRaw.compilerOptions.jsxImportSource = undefined)
//     options.target &&
//       (resolvedOptions.tsconfigRaw.compilerOptions.target = undefined)
//   }

//   delete resolvedOptions.include
//   delete resolvedOptions.exclude
//   delete resolvedOptions.jsxInject

//   try {
//     const result = await transform(code, resolvedOptions)
//     let map: SourceMap
//     if (inMap && resolvedOptions.sourcemap) {
//       const nextMap = JSON.parse(result.map)
//       nextMap.sourcesContent = []
//       map = combineSourcemaps(filename, [
//         nextMap as RawSourceMap,
//         inMap as RawSourceMap,
//       ]) as SourceMap
//     } else {
//       map =
//         resolvedOptions.sourcemap && resolvedOptions.sourcemap !== 'inline'
//           ? JSON.parse(result.map)
//           : { mappings: '' }
//     }
//     if (Array.isArray(map.sources)) {
//       map.sources = map.sources.map((it) => toUpperCaseDriveLetter(it))
//     }
//     return {
//       ...result,
//       map,
//     }
//   } catch (e: any) {
//     debug(`esbuild error with options used: `, resolvedOptions)
//     // patch error information
//     if (e.errors) {
//       e.frame = ''
//       e.errors.forEach((m: Message) => {
//         e.frame += `\n` + prettifyMessage(m, code)
//       })
//       e.loc = e.errors[0].location
//     }
//     throw e
//   }
// }
