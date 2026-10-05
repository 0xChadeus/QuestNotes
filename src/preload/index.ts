import { contextBridge, ipcRenderer } from 'electron'
import { EVENTS } from '../shared/api'

contextBridge.exposeInMainWorld('qn', {
  invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args),
  on(event: string, cb: (...args: unknown[]) => void) {
    if (!EVENTS.includes(event as never)) throw new Error(`unknown event ${event}`)
    const l = (_: unknown, ...args: unknown[]) => cb(...args)
    ipcRenderer.on(event, l)
    return () => { ipcRenderer.off(event, l) }
  },
})
