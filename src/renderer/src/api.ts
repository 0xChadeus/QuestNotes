import type { Events, Invoke } from '../../shared/api'

declare global {
  interface Window { qn: { invoke(channel: string, ...args: unknown[]): Promise<unknown>; on(event: string, cb: (...args: any[]) => void): () => void } }
}

export const call = <K extends keyof Invoke>(channel: K, ...args: Parameters<Invoke[K]>) =>
  window.qn.invoke(channel, ...args) as Promise<Awaited<ReturnType<Invoke[K]>>>
export const on = <K extends keyof Events>(event: K, cb: Events[K]) => window.qn.on(event, cb)
