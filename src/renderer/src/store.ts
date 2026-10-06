import { create } from 'zustand'
import { call } from './api'
import { fileFor, newId, refsOf, today, type Data, type Page } from '../../shared/page'
import { resolveSchema, type Schema, type Status } from '../../shared/schema'
import type { EngineIndex } from '../../shared/engine'
import type { BridgeState, FileConflict, GitStatus, MapView, Project } from '../../shared/api'
import { freeSpot, place, tidyMap } from '../../shared/map'
import { byType, kindLabel, type Pages } from './derive'

export type View = 'map' | 'matrix' | 'cast' | 'handoff' | 'issues' | 'trash' | `list:${string}`
interface Toast { id: number; text: string; action?: { label: string; run: () => void }; key?: string }
export type MenuItem = { label: string; run: () => void; key?: string; danger?: boolean; on?: boolean } | '-'
interface Ask { title: string; value: string; ok: string; run: (v: string) => void; placeholder?: string }

interface State {
  project?: Omit<Project, 'pages' | 'map' | 'engine' | 'bridge' | 'git' | 'issues' | 'trashed'>
  schema: Schema; pages: Pages; map: MapView; engine: EngineIndex | null; bridge: BridgeState; git?: GitStatus; issues: string[]
  view: View; full: string | null; peek: string[]; brief: boolean
  /** The card or row the keyboard acts on, and the others picked with Ctrl- or Shift-click. */
  selected: string | null; multi: string[]
  filters: string[]; text: string; payoffs: boolean
  palette: boolean; dialog: null | 'import' | 'settings' | 'project' | 'shortcuts' | 'sync' | 'ask'; ask?: Ask
  menu?: { x: number; y: number; items: MenuItem[] }
  toasts: Toast[]; recent: string[]; saved: number; conflicts?: FileConflict[]
  /** Pages waiting to be written, and whether the last write failed. */
  dirty: number; failed: boolean
  /** What Ctrl+Z and Ctrl+Shift+Z would undo and redo, for tooltips. */
  canUndo?: string; canRedo?: string
}

export const useStore = create<State>(() => ({
  schema: resolveSchema(), pages: {}, map: {}, engine: null, bridge: 'no-game', issues: [], view: 'map', full: null, peek: [], brief: false, selected: null, multi: [],
  filters: [], text: '', payoffs: false, palette: false, dialog: null, toasts: [], recent: [], saved: 0, dirty: 0, failed: false,
}))
const set = useStore.setState
const get = useStore.getState

/** Opens a project. Reopening the same one (after its settings change) keeps what is on screen. */
export function loadProject(p: Project) {
  const same = get().project?.root === p.root
  if (!same) { past.length = future.length = back.length = ahead.length = 0; mark() }
  setBinned(p.trashed)
  const pages = Object.fromEntries(p.pages.map((x) => [x.data.id, x]))
  set({
    project: { root: p.root, config: p.config, errors: p.errors, game: p.game, godot: p.godot }, schema: resolveSchema(p.config),
    pages, map: p.map, engine: p.engine, bridge: p.bridge, git: p.git, issues: p.issues,
    ...(same ? { peek: get().peek.filter((id) => pages[id]), full: get().full && pages[get().full!] ? get().full : null }
      : { view: 'map' as View, full: null, peek: [], selected: null, multi: [], filters: [], recent: [] }),
  })
}

// Undo history. Every change to pages or the map records each page's state before and after; undo puts the "before" back.
type Snap = Page | null
interface Entry { before: Snap; after: Snap; trash?: boolean; bin?: string }
interface Change { label: string; at: number; key?: string; pages: Map<string, Entry>; map?: { before: MapView; after: MapView } }
const past: Change[] = [], future: Change[] = []
let batching: Change | null = null, applying = false
const mark = () => set({ canUndo: past[past.length - 1]?.label, canRedo: future[future.length - 1]?.label })

/** Adds to the change in progress: the open batch, the last change when `key` says it continues it (typing), or a new one. */
function record(label: string, key: string | undefined, fn: (c: Change) => void): Change | undefined {
  if (applying) return
  if (batching) { fn(batching); return batching }
  const top = past[past.length - 1]
  if (key && top?.key === key && Date.now() - top.at < 1500) { fn(top); top.at = Date.now(); return top }
  const c: Change = { label, at: Date.now(), key, pages: new Map() }
  fn(c)
  past.push(c); if (past.length > 300) past.shift()
  future.length = 0
  mark()
  return c
}
const note = (c: Change, id: string, before: Snap, after: Snap, trash?: boolean) => {
  const e = c.pages.get(id)
  if (e) { e.after = after; e.trash ||= trash } else c.pages.set(id, { before, after, trash })
}
const forget = (c: Change) => { const i = past.indexOf(c); if (i >= 0) past.splice(i, 1); mark() }

/** The undo step just recorded, for a toast's Undo button. */
export const lastChange = () => past[past.length - 1]

/** Groups everything `fn` changes into one undo step. */
export async function batch<T>(label: string, fn: () => T | Promise<T>): Promise<T> {
  if (batching || applying) return fn()
  const c: Change = batching = { label, at: Date.now(), pages: new Map() }
  try { return await fn() } finally {
    batching = null
    if (c.pages.size || c.map) { past.push(c); future.length = 0; mark() }
  }
}

async function apply(c: Change, undo: boolean) {
  applying = true
  try {
    for (const [id, e] of c.pages) await put(id, undo ? e.before : e.after, e)
    if (c.map) writeMap(undo ? c.map.before : c.map.after)
  } finally { applying = false }
}
/** Makes a page what it was: restored from the Trash, written, moved to the Trash or deleted. */
async function put(id: string, page: Snap, e: Entry) {
  const cur = get().pages[id]
  if (page && cur) return update(id, () => page)
  if (page) {
    if (e.trash) {
      try { await call('page:restore', e.bin ?? page.file, page.file); binned.delete(id) } catch (err) { return toast(`Could not restore ${page.data.title}: ${message(err)}`) }
    }
    set({ pages: { ...get().pages, [id]: page } })
    await call('page:write', page)
  } else if (cur) {
    drop(id)
    if (e.trash) { e.bin = await call('page:trash', cur.file); binned.add(id) } else await call('page:delete', cur.file)
  }
}
const drop = (id: string) => {
  const pages = { ...get().pages }
  delete pages[id]
  clearTimeout(timers.get(id)); pending.delete(id); fresh.delete(id)
  const s = get()
  set({ pages, peek: s.peek.filter((x) => x !== id), full: s.full === id ? null : s.full, selected: s.selected === id ? null : s.selected, multi: s.multi.filter((x) => x !== id), dirty: pending.size })
}
const message = (e: unknown) => String(e).replace(/^.*Error: /, '')

const lower = (s: string) => s[0].toLowerCase() + s.slice(1)
export async function undo(c?: Change) {
  const i = c ? past.lastIndexOf(c) : past.length - 1
  if (i < 0) { if (!c) toast('Nothing to undo', undefined, 'history'); return }
  const [x] = past.splice(i, 1)
  await flushAll()
  await apply(x, true)
  future.push(x)
  mark()
  toast(`Undid ${lower(x.label)}`, { label: 'Redo', run: () => redo() }, 'history')
}
export async function redo() {
  const x = future.pop()
  if (!x) return toast('Nothing to redo', undefined, 'history')
  await apply(x, false)
  past.push(x)
  mark()
  toast(`Redid ${lower(x.label)}`, undefined, 'history')
}

// Saving: a burst of edits to one page is one write, a short pause after the last.
const timers = new Map<string, ReturnType<typeof setTimeout>>()
const pending = new Set<string>()
async function save(id: string) {
  clearTimeout(timers.get(id))
  if (!pending.delete(id)) return
  set({ dirty: pending.size })
  const p = get().pages[id]
  if (!p) return
  try { await call('page:write', p); set({ saved: Date.now(), failed: false }) } catch (e) {
    pending.add(id)
    set({ dirty: pending.size, failed: true })
    toast(`Could not save ${p.data.title || 'a page'}: ${message(e)}`, { label: 'Retry', run: () => save(id) }, `save:${id}`)
  }
}
/** Writes everything not yet on disk, including text still in the editor. */
export async function flushAll() {
  window.dispatchEvent(new Event('qn:flush'))
  await Promise.all([...pending].map(save))
}

/** Changes a page now and writes it after a short pause. Without a label, edits to one page in quick succession are one undo step. */
export function update(id: string, fn: (p: Page) => Page, label?: string) {
  const p = get().pages[id]
  if (!p) return
  const next = fn(p)
  if (next === p) return
  if (next.data.type === 'quest' && next.data.status === 'ready' && !next.data.engine?.handoff_on)
    next.data = { ...next.data, engine: { ...next.data.engine, handoff_on: today() } }
  record(label ?? `Edit ${p.data.title || 'page'}`, label ? undefined : `edit:${id}`, (c) => note(c, id, p, next))
  pending.add(id)
  set({ pages: { ...get().pages, [id]: next }, dirty: pending.size })
  clearTimeout(timers.get(id))
  timers.set(id, setTimeout(() => save(id), 400))
}
export const setData = (id: string, patch: Partial<Data>, label?: string) => update(id, (p) => ({ ...p, data: { ...p.data, ...patch } }), label)

/** Pages changed on disk by git or another editor; ignored while a local save is pending. */
export function remoteChange(file: string, page: Page | null) {
  const pages = { ...get().pages }
  const old = Object.values(pages).find((p) => p.file === file)
  if (old && pending.has(old.data.id)) return
  if (old) delete pages[old.data.id]
  if (page) pages[page.data.id] = page
  set({ pages })
  const s = get()
  if (old && !page && (s.full === old.data.id || s.peek.includes(old.data.id))) toast(`${old.data.title || 'A page'} was deleted outside QuestNotes.`)
}

// Ids of pages in the Trash, so a new page never takes one and a restore never collides.
const binned = new Set<string>()
export function setBinned(ids: string[]) { binned.clear(); ids.forEach((id) => binned.add(id)) }

// Pages created blank in this session: closed without a single edit, they are thrown away instead of piling up as "Untitled".
const fresh = new Map<string, { page: Page; change?: Change }>()
useStore.subscribe((s, prev) => {
  for (const [id, f] of fresh) {
    const open = (x: typeof s) => x.full === id || x.peek.includes(id)
    if (open(s) || !open(prev)) continue
    fresh.delete(id)
    if (s.pages[id] !== f.page || f.page.data.title || (f.change && f.change.pages.size > 1)) continue
    drop(id)
    if (f.change) forget(f.change)
    call('page:delete', f.page.file)
    pruneMap([...binned])
  }
})

export async function createPage(type: string, title: string, data: Partial<Data> = {}, body?: string) {
  const s = get().schema
  const id = newId(s, type, title || 'untitled', (x) => !!get().pages[x] || binned.has(x))
  const order = (type === 'act' || type === 'questline') && data.order === undefined
    ? { order: Math.max(0, ...byType(get().pages, type).map((x) => x.data.order ?? 0)) + 1, ...(type === 'act' ? { subsections: [] } : { kind: 'side' }) } : {}
  const page: Page = { file: fileFor(s, type, id), data: { id, type, title, ...(type === 'quest' ? { status: 'idea' as Status } : {}), ...order, ...data }, body: body ?? s.template[type] ?? '' }
  const c = record(`Create ${title || `a ${kindLabel(s, type).toLowerCase()}`}`, undefined, (c) => note(c, id, null, page))
  set({ pages: { ...get().pages, [id]: page } })
  if (!title) fresh.set(id, { page, change: c })
  try { await call('page:write', page) } catch (e) {
    drop(id)
    if (c && !batching) forget(c)
    toast(`Could not create ${title || 'the page'}: ${message(e)}`)
  }
  return id
}

/** Moves pages to the Trash, saying what still points at them, with an Undo. */
export async function trashPages(ids: string[]) {
  const s = get(), list = ids.map((id) => s.pages[id]).filter(Boolean)
  if (!list.length) return
  const gone = new Set(list.map((p) => p.data.id))
  const rest = Object.values(s.pages).filter((p) => !gone.has(p.data.id))
  const linking = rest.filter((p) => refsOf(s.schema, p).some((r) => gone.has(r))).length
  const name = list.length === 1 ? list[0].data.title || 'Untitled' : `${list.length} pages`
  const c = record(`Delete ${name}`, undefined, (c) => list.forEach((p) => note(c, p.data.id, p, null, true)))
  await flushAll()
  for (const p of list) {
    drop(p.data.id)
    const bin = await call('page:trash', p.file)
    binned.add(p.data.id)
    const e = c?.pages.get(p.data.id)
    if (e) e.bin = bin
  }
  const why = linking ? ` ${linking} page${linking > 1 ? 's' : ''} still link${linking > 1 ? '' : 's'} to ${list.length > 1 ? 'them' : 'it'}.` : ''
  toast(`Moved ${name} to the Trash.${why}`, c && { label: 'Undo', run: () => undo(c) })
}
export const trashPage = (id: string) => trashPages([id])

/** Puts a page from the Trash view back, as an undoable change. */
export async function restorePage(p: Page) {
  const file = p.file.replace(/~\d+\.md$/, '.md')
  const page = { ...p, file }
  try { await call('page:restore', p.file, file) } catch (e) { return toast(`Could not restore ${p.data.title}: ${message(e)}`) }
  binned.delete(p.data.id)
  record(`Restore ${p.data.title}`, undefined, (c) => c.pages.set(p.data.id, { before: null, after: page, trash: true }))
  set({ pages: { ...get().pages, [p.data.id]: page } })
}

export async function duplicate(id: string) {
  const p = get().pages[id]
  if (!p) return
  const { id: _, engine: __, code: ___, ...data } = p.data
  const title = `${p.data.title || 'Untitled'} (copy)`
  const at = get().map.nodes?.find((n) => n.id === id)
  const nid = await batch(`Duplicate ${p.data.title}`, async () => {
    const nid = await createPage(p.data.type, title, { ...data, title, ...(data.status === 'ready' ? { status: 'draft' as Status } : {}) }, p.body)
    if (at) placeCards({ [nid]: freeSpot(get().map, at.x + 40, at.y + 40) })
    return nid
  })
  peek(nid)
}

/** Copies of quests, placed (dx, dy) from the originals; "leads to" links among the copied quests point at the copies. */
export async function duplicateAll(ids: string[], dx = 40, dy = 40) {
  const made = new Map<string, string>()
  await batch(`Duplicate ${named(ids, 'quest')}`, async () => {
    for (const id of ids) {
      const p = get().pages[id]
      if (!p) continue
      const { id: _, engine: __, code: ___, ...data } = p.data
      const title = `${p.data.title || 'Untitled'} (copy)`
      made.set(id, await createPage(p.data.type, title, { ...data, title, ...(data.status === 'ready' ? { status: 'draft' as Status } : {}) }, p.body))
    }
    const at: Record<string, { x: number; y: number }> = {}
    for (const [from, to] of made) {
      const links = (get().pages[to]?.data.leads_to ?? []) as { ref?: string }[]
      if (links.some((r) => r.ref && made.has(r.ref))) setData(to, { leads_to: links.map((r) => (r.ref && made.has(r.ref) ? { ...r, ref: made.get(r.ref) } : r)) })
      const n = get().map.nodes?.find((x) => x.id === from)
      if (n) at[to] = { x: n.x + dx, y: n.y + dy }
    }
    if (Object.keys(at).length) placeCards(at)
  })
  return made
}

/** Moves a page one place earlier or later among pages of its kind, renumbering their `order`. */
export function reorder(id: string, dir: -1 | 1) {
  const p = get().pages[id]
  if (!p) return
  const list = byType(get().pages, p.data.type)
  const i = list.findIndex((x) => x.data.id === id), j = i + dir
  if (j < 0 || j >= list.length) return
  ;[list[i], list[j]] = [list[j], list[i]]
  batch(`Move ${p.data.title}`, () => list.forEach((x, n) => x.data.order !== n + 1 && setData(x.data.id, { order: n + 1 })))
}

/** Sub-sections of an act: renaming or removing one carries its quests along. */
const inSub = (act: string, sub: string) => Object.values(get().pages).filter((q) => q.data.type === 'quest' && q.data.act === act && q.data.subsection === sub)
export function renameSubsection(act: string, from: string, to: string) {
  const subs: string[] = get().pages[act]?.data.subsections ?? []
  if (!to || to === from || subs.includes(to)) return
  return batch(`Rename ${from}`, () => { setData(act, { subsections: subs.map((x) => (x === from ? to : x)) }); inSub(act, from).forEach((q) => setData(q.data.id, { subsection: to })) })
}
export async function removeSubsection(act: string, sub: string) {
  const subs: string[] = get().pages[act]?.data.subsections ?? [], quests = inSub(act, sub)
  await batch(`Remove ${sub}`, () => { setData(act, { subsections: subs.filter((x) => x !== sub) }); quests.forEach((q) => setData(q.data.id, { subsection: undefined })) })
  const c = lastChange()
  toast(`Removed ${sub}.${quests.length ? ` Its ${quests.length} quest${quests.length > 1 ? 's' : ''} moved to the act's first column.` : ''}`, { label: 'Undo', run: () => undo(c) })
}
const named = (ids: string[], what: string) => (ids.length > 1 ? `${ids.length} ${what}s` : get().pages[ids[0]]?.data.title || `a ${what}`)
/** Takes quests off the map, back to the Hooks tray. */
export const unplace = (ids: string[]) => placeCards(Object.fromEntries(ids.map((id) => [id, null])), `Move ${named(ids, 'quest')} to Hooks`)
/** Arrow keys: moves cards a few pixels; a burst of presses is one undo step. */
export function nudge(ids: string[], dx: number, dy: number) {
  const at = Object.fromEntries((get().map.nodes ?? []).filter((n) => ids.includes(n.id)).map((n) => [n.id, { x: n.x + dx, y: n.y + dy }]))
  if (Object.keys(at).length) placeCards(at, `Nudge ${named(ids, 'quest')}`, 'nudge')
}
/** Selects the next quest along "leads to" links (dir 1) or the one that leads here (dir -1), and pans to it. */
export function walk(dir: 1 | -1) {
  const s = get(), id = s.selected, placed = new Set((s.map.nodes ?? []).map((n) => n.id))
  if (!id) return
  const quests = byType(s.pages, 'quest').filter((q) => placed.has(q.data.id))
  const next = dir === 1 ? (s.pages[id]?.data.leads_to ?? []).map((r: { ref?: string }) => r.ref).find((r: string) => placed.has(r))
    : quests.find((q) => (q.data.leads_to ?? []).some((r: { ref?: string }) => r.ref === id))?.data.id
  if (!next) return toast(dir === 1 ? 'This quest leads nowhere on the map.' : 'No quest on the map leads here.', undefined, 'walk')
  set({ selected: next, multi: [] })
  window.dispatchEvent(new CustomEvent('qn:focus', { detail: { id: next, keep: true } }))
}
/** Sets the status of several quests as one step. */
export const setStatus = (ids: string[], status: Status, label: string) =>
  batch(ids.length > 1 ? `Set ${ids.length} quests to ${label}` : `Set ${get().pages[ids[0]]?.data.title || 'a quest'} to ${label}`, () => ids.forEach((id) => setData(id, { status })))

export function toast(text: string, action?: Toast['action'], key?: string) {
  const t = { id: Date.now() + Math.random(), text, action, key }
  set({ toasts: [...get().toasts.filter((x) => !key || x.key !== key).slice(-2), t] })
  setTimeout(() => set({ toasts: get().toasts.filter((x) => x !== t) }), 6000)
}
export const ask = (a: Ask) => set({ dialog: 'ask', ask: a })

// Where the designer has been: Alt+Left and Alt+Right (or the mouse's back and forward buttons) move through it.
interface Loc { view: View; full: string | null }
const back: Loc[] = [], ahead: Loc[] = []
const here = (): Loc => ({ view: get().view, full: get().full })
const visit = (to: Loc) => {
  const at = here()
  if (at.view === to.view && at.full === to.full) return
  back.push(at); if (back.length > 50) back.shift()
  ahead.length = 0
  set({ ...to, peek: to.full ? [] : get().peek, ...(to.view !== at.view ? { selected: null, multi: [] } : {}) })
}
const step = (from: Loc[], to: Loc[]) => {
  let l = from.pop()
  while (l?.full && !get().pages[l.full]) l = from.pop()
  if (!l) return false
  to.push(here())
  set({ view: l.view, full: l.full, ...(l.view !== get().view ? { selected: null, multi: [] } : {}) })
  return true
}
export const goBack = () => step(back, ahead)
export const goForward = () => step(ahead, back)

const seen = (id: string) => set({ recent: [id, ...get().recent.filter((x) => x !== id)].slice(0, 8) })
export function peek(id: string, brief = false) { seen(id); set({ peek: [...get().peek.filter((x) => x !== id), id], brief, selected: id, multi: [] }) }
export function openFull(id: string) { seen(id); visit({ view: get().view, full: id }); set({ brief: false, selected: id, multi: [] }) }
export function go(view: View) { visit({ view, full: null }) }
/** Ctrl- or Shift-click: adds a card or row to the picked set, or takes it out. */
export function pick(id: string) {
  const s = get(), all = new Set(s.multi.length ? s.multi : s.selected ? [s.selected] : [])
  if (all.has(id)) all.delete(id); else all.add(id)
  set({ multi: all.size > 1 ? [...all] : [], selected: [...all].pop() ?? null })
}
/** What a key or menu acts on: every picked card, or the selected one. */
export const targets = () => { const s = get(); return s.multi.length ? s.multi.filter((id) => s.pages[id]) : s.selected && s.pages[s.selected] ? [s.selected] : [] }
export function toggleFilter(id: string, add = false) {
  const f = get().filters
  set({ filters: f.includes(id) ? f.filter((x) => x !== id) : add ? [...f, id] : [id] })
  if (get().view !== 'map' || get().full) go('map')
}
/** Opens the map with a quest selected and in view. */
export function showOnMap(id: string) {
  const q = get().pages[id]
  if (!q) return
  go('map')
  set({ selected: id, multi: [] })
  if (!get().map.nodes?.some((n) => n.id === id)) toast(`${q.data.title || 'This quest'} is not on the map yet; it waits in Hooks.`)
  else setTimeout(() => window.dispatchEvent(new CustomEvent('qn:focus', { detail: { id } })), 50)
}

/** Changes the map as one undo step. A `key` makes a quick run of changes (arrow nudges) one step. */
export function writeMap(map: MapView, label = 'Arrange the map', key?: string) {
  const before = get().map
  map = tidyMap(map)
  record(label, key, (c) => { c.map = { before: c.map?.before ?? before, after: map } })
  set({ map })
  call('view:write', 'map', map)
}
export const placeCards = (at: Parameters<typeof place>[1], label?: string, key?: string) => writeMap(place(get().map, at), label, key)
/** Forgets positions of pages that are neither live nor in the Trash (after the Trash is emptied). Not an undo step. */
export function pruneMap(trashed: string[]) {
  const keep = new Set([...Object.keys(get().pages), ...trashed]), gone = (get().map.nodes ?? []).filter((n) => !keep.has(n.id))
  if (!gone.length) return
  const map = place(get().map, Object.fromEntries(gone.map((n) => [n.id, null])))
  set({ map })
  call('view:write', 'map', map)
}

// The middle of the map as last seen, where a new quest made from the keyboard lands.
let middle: { x: number; y: number } | null = null
export const setMiddle = (p: { x: number; y: number }) => { middle = p }
/** A new quest, placed on the map near `at` (or the middle of the view) where it overlaps nothing. */
export async function createQuest(data: Partial<Data> = {}, at: { x: number; y: number } | null = middle, label?: string) {
  return batch(label ?? 'Create a quest', async () => {
    const id = await createPage('quest', '', data)
    if (at && get().pages[id]) placeCards({ [id]: freeSpot(get().map, at.x, at.y) })
    return id
  })
}
