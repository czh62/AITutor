import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { StoreApi, UseBoundStore } from 'zustand'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    const value = error as {
      message?: unknown
      response?: { data?: { detail?: unknown; message?: unknown } }
    }
    const detail = value.response?.data?.detail ?? value.response?.data?.message ?? value.message
    if (typeof detail === 'string') return detail
    try {
      return JSON.stringify(error)
    } catch {
      return 'Unknown error'
    }
  }
  return 'Unknown error'
}

type WithSelectors<S> = S extends { getState: () => infer T }
  ? S & { use: { [K in keyof T]: () => T[K] } }
  : never

export function createSelectors<S extends UseBoundStore<StoreApi<any>>>(_store: S) {
  const store = _store as WithSelectors<S>
  store.use = {} as WithSelectors<S>['use']

  for (const key of Object.keys(store.getState()) as Array<keyof ReturnType<S['getState']>>) {
    const selector = key as keyof ReturnType<S['getState']>
    ;(store.use as Record<typeof selector, () => ReturnType<S['getState']>[typeof selector]>)[
      selector
    ] = () => store((state) => state[selector])
  }

  return store
}
