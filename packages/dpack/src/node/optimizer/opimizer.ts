import type { DepsOptimizer } from '.'
import type { ResolvedConfig } from '../config'

const debounceMs = 100

const depsOptimizerMap = new WeakMap<ResolvedConfig, DepsOptimizer>()
const devSsrDepsOptimizerMap = new WeakMap<ResolvedConfig, DepsOptimizer>()

export function getDepsOptimizer(
  config: ResolvedConfig,
): DepsOptimizer | undefined {
  // Workers compilation shares the DepsOptimizer from the main build
  return depsOptimizerMap.get(config)
}
