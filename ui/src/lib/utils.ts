import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { StoreApi, UseBoundStore } from 'zustand'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

type WithSelectors<S> = S extends { getState: () => infer T }
  ? S & { use: { [K in keyof T]: () => T[K] } }
  : never

export function createSelectors<S extends UseBoundStore<StoreApi<object>>>(store: S) {
  const typedStore = store as WithSelectors<typeof store>
  typedStore.use = {} as WithSelectors<typeof store>['use']
  for (const key of Object.keys(store.getState())) {
    ;(typedStore.use as Record<string, unknown>)[key] = () =>
      store((state) => state[key as keyof typeof state])
  }
  return typedStore
}
