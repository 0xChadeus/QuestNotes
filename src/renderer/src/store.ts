import { create } from 'zustand'
import { call } from './api'
import { fileFor, newId, today, type Data, type Page } from '../../shared/page'
import { QUEST_TEMPLATE, type PageType, type Status } from '../../shared/schema'
import type { EngineIndex } from '../../shared/engine'
import type { BridgeState, FileConflict, GitStatus, MapView, Project } from '../../shared/api'
import type { Pages } from './derive'

export type View = 'map' | 'ledger' | 'cast' | 'handoff' | 'issues' | 'trash' | `list:${PageType}`
interface Toast { id: number; text: string; action?: { label: string; run: () => void } }

interface State {
  project?: Omit<Project, 'pages' | 'map' | 'engine' | 'bridge' | 'git' | 'issues'>
  pages: Pages; map: MapView; engine: EngineIndex | null; bridge: BridgeState; git?: GitStatus; issues: string[]
  view: View; full: string | null; peek: string[]; brief: boolean; selected: string | null
  filters: string[]; text: string; payoffs: boolean
  palette: boolean; dialog: null | 'import' | 'settings' | 'shortcuts' | 'sync'; toasts: Toast[]; recent: string[]; saved: number; conflicts?: FileConflict[]
}

export const useStore = create<State>(() => ({
  pages: {}, map: {}, engine: null, bridge: 'no-game', issues: [], view: 'map', full: null, peek: [], brief: false, selected: null,
  filters: [], text: '', payoffs: false, palette: false, dialog: null, toasts: [], recent: [], saved: 0,
}))
const set = useStore.setState
const get = useStore.getState

export function loadProject(p: Project) {
  set({
    project: { root: p.root, name: p.name, errors: p.errors, game: p.game, godot: p.godot },
    pages: Object.fromEntries(p.pages.map((x) => [x.data.id, x])), map: p.map, engine: p.engine, bridge: p.bridge, git: p.git,
    issues: p.issues, view: 'map', full: null, peek: [], selected: null, filters: [],
  })
}

const timers = new Map<string, ReturnType<typeof setTimeout>>()
const pending = new Set<string>()
/** Changes a page now and writes it after a short pause, so a burst of edits is one save. */
export function update(id: string, fn: (p: Page) => Page) {
  const p = get().pages[id]
  if (!p) return
  const next = fn(p)
  if (next.data.type === 'quest' && next.data.status === 'ready' && !next.data.animus?.handoff_on)
    next.data = { ...next.data, animus: { ...next.data.animus, handoff_on: today() } }
  set({ pages: { ...get().pages, [id]: next } })
  pending.add(id)
  clearTimeout(timers.get(id))
  timers.set(id, setTimeout(async () => { pending.delete(id); await call('page:write', get().pages[id]); set({ saved: Date.now() }) }, 400))
}
export const setData = (id: string, patch: Partial<Data>) => update(id, (p) => ({ ...p, data: { ...p.data, ...patch } }))

/** Pages changed on disk by git or another editor; ignored while a local save is pending. */
export function remoteChange(file: string, page: Page | null) {
  const pages = { ...get().pages }
  const old = Object.values(pages).find((p) => p.file === file)
  if (old && pending.has(old.data.id)) return
  if (old) delete pages[old.data.id]
  if (page) pages[page.data.id] = page
  set({ pages })
}

export async function createPage(type: PageType, title: string, data: Partial<Data> = {}, body?: string) {
  const id = newId(type, title || 'untitled', (x) => !!get().pages[x])
  const page: Page = { file: fileFor(type, id), data: { id, type, title, ...(type === 'quest' ? { status: 'idea' as Status } : {}), ...data }, body: body ?? (type === 'quest' ? QUEST_TEMPLATE : '') }
  set({ pages: { ...get().pages, [id]: page } })
  await call('page:write', page)
  return id
}

export async function trashPage(id: string) {
  const p = get().pages[id]
  if (!p) return
  const pages = { ...get().pages }
  delete pages[id]
  set({ pages, peek: get().peek.filter((x) => x !== id), full: get().full === id ? null : get().full, selected: null })
  await call('page:trash', p.file)
  toast(`Moved ${p.data.title} to the Trash`, { label: 'Undo', run: async () => { await call('page:restore', p.file); set({ pages: { ...get().pages, [id]: p } }) } })
}

export function toast(text: string, action?: Toast['action']) {
  const t = { id: Date.now() + Math.random(), text, action }
  set({ toasts: [...get().toasts, t] })
  setTimeout(() => set({ toasts: get().toasts.filter((x) => x !== t) }), 6000)
}

const seen = (id: string) => set({ recent: [id, ...get().recent.filter((x) => x !== id)].slice(0, 8) })
export function peek(id: string, brief = false) { seen(id); set({ peek: [...get().peek.filter((x) => x !== id), id], brief, selected: id }) }
export function openFull(id: string) { seen(id); set({ full: id, peek: [], brief: false, selected: id }) }
export function go(view: View) { set({ view, full: null }) }
export function toggleFilter(id: string, add = false) {
  const f = get().filters
  set({ filters: f.includes(id) ? f.filter((x) => x !== id) : add ? [...f, id] : [id], view: get().view.startsWith('list') ? 'map' : get().view, full: null })
}
export function writeMap(map: MapView) { set({ map }); call('view:write', 'map', map) }
