import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { defineConfig, RollupOptions, Plugin } from 'rollup'
import typescript from '@rollup/plugin-typescript'
import nodeResolve from '@rollup/plugin-node-resolve'
import commonjs from '@rollup/plugin-commonjs'
import json from '@rollup/plugin-json'
import { readFileSync } from 'node:fs'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const pkg = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url)).toString(),
)

const envConfig = defineConfig({
  input: path.resolve(__dirname, 'src/client/env.ts'),
  plugins: [
    typescript({
      tsconfig: path.resolve(__dirname, 'src/client/tsconfig.json'),
    }),
  ],
  output: {
    file: path.resolve(__dirname, 'dist/client', 'env.mjs'),
    sourcemap: true,
  },
})

const clientConfig = defineConfig({
  input: path.resolve(__dirname, 'src/client/client.ts'),
  plugins: [
    typescript({
      tsconfig: path.resolve(__dirname, 'src/client/tsconfig.json'),
    }),
  ],
  output: {
    file: path.resolve(__dirname, 'dist/client', 'client.mjs'),
    sourcemap: true,
  },
})

const sharedNodeOptions = defineConfig({
  treeshake: {
    moduleSideEffects: 'no-external',
    propertyReadSideEffects: false,
    tryCatchDeoptimization: false,
  },
  output: {
    dir: path.resolve(__dirname, 'dist'),
    entryFileNames: `node/[name].js`,
    chunkFileNames: 'node/chunks/dep-[hash].js',
    exports: 'named',
    format: 'esm',
    externalLiveBindings: false,
    freeze: false,
  },
  onwarn(warning, warn) {
    // node-resolve complains a lot about this but seems to still work?
    if (warning.message.includes('Package subpath')) {
      return
    }
    // we use the eval('require') trick to deal with optional deps
    if (warning.message.includes('Use of eval')) {
      return
    }
    if (warning.message.includes('Circular dependency')) {
      return
    }
    warn(warning)
  },
})

function createNodePlugins(
  isProduction: boolean,
  sourceMap: boolean,
  declarationDir: string | false,
): (Plugin | false)[] {
  return [
    nodeResolve({ preferBuiltins: true }),
    typescript({
      tsconfig: path.resolve(__dirname, 'src/node/tsconfig.json'),
      sourceMap,
      declaration: declarationDir !== false,
      declarationDir: declarationDir !== false ? declarationDir : void 0,
    }),
    commonjs({
      extensions: ['.js'],
      ignore: ['bufferutil', 'utf-8-validate'],
    }),
    json(),
  ]
}

function createNodeConfig(isProduction: boolean) {
  return defineConfig({
    ...sharedNodeOptions,
    input: {
      index: path.resolve(__dirname, 'src/node/index.ts'),
      cli: path.resolve(__dirname, 'src/node/cli.ts'),
      constants: path.resolve(__dirname, 'src/node/constants.ts'),
    },
    output: {
      ...sharedNodeOptions.output,
      sourcemap: !isProduction,
    },
    external: ['fsevent', ...Object.keys(pkg.dependencies)],
    plugins: createNodePlugins(
      isProduction,
      !isProduction,
      path.resolve(__dirname, 'dist/node'),
    ),
  })
}

export default (commandLineArgs: any): RollupOptions[] => {
  const isDev = commandLineArgs.watch
  const isProduction = !isDev

  return defineConfig([
    envConfig,
    clientConfig,
    createNodeConfig(isProduction),
    // createCjsConfig(isProduction),
  ])
}
