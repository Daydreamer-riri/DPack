import type {
  ErrorPayload,
  FullReloadPayload,
  PrunePayload,
  UpdatePayload,
} from './hmrPayload'

export interface CustomEventMap {
  beforeUpdate: UpdatePayload
  afterUpdate: UpdatePayload
  beforePrune: PrunePayload
  beforeFullReload: FullReloadPayload
  error: ErrorPayload
  invalidate: InvalidatePayload
}

export interface InvalidatePayload {
  path: string
  message: string | undefined
}

export type InferCustomEventPayload<T extends string> =
  T extends keyof CustomEventMap ? CustomEventMap[T] : any
