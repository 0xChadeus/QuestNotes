// The free-form map: where each quest card, frame and note sits. views/map.yaml holds one line per item, sorted by id, so two
// designers moving different cards never touch the same line. Links are not stored here; they come from the lore.
import type { Data } from './page'

export const CARD_W = 230, CARD_H = 116, NOTE_W = 220, NOTE_H = 120
export interface MapNode { id: string; x: number; y: number }
export interface MapFrame extends MapNode { label: string; w: number; h: number; color?: number }
/** A note: free text on the canvas. Colour 0 (or none) is the usual yellow; 1–6 are the area colours. */
export interface MapNote extends MapNode { text: string; w?: number; h?: number; color?: number }
/** Version 2. Version 1 (the act × questline grid) held only `cells`, the order of cards inside each grid cell. */
export interface MapView { version?: number; nodes?: MapNode[]; frames?: MapFrame[]; notes?: MapNote[]; cells?: Record<string, string[]> }
type Key = 'nodes' | 'frames' | 'notes'
const KEYS: Key[] = ['nodes', 'frames', 'notes']
type At = Record<string, { x: number; y: number } | null>

export const roman = (n: number) => ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][n] ?? String(n)
const whole = <T extends MapNode>(i: T): T => { const f = i as unknown as MapFrame; return { ...i, x: Math.round(i.x), y: Math.round(i.y), ...(f.w !== undefined ? { w: Math.round(f.w), h: Math.round(f.h) } : {}) } }

/** The stored shape: whole numbers, sorted by id, empty lists left out. */
export function tidyMap(m: MapView): MapView {
  const out: MapView = { version: 2 }
  for (const k of KEYS) { const list = (m[k] ?? []).map(whole).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)); if (list.length) out[k] = list as never }
  return out
}

/** Puts cards where `at` says, or takes them off the map (back to Hooks) with null. */
export const place = (m: MapView, at: At) =>
  tidyMap({ ...m, nodes: [...(m.nodes ?? []).filter((n) => !(n.id in at)), ...Object.entries(at).flatMap(([id, p]) => (p ? [{ id, x: p.x, y: p.y }] : []))] })

/** Adds, changes (a partial item merges in) or, with null, removes one frame or note. */
export function edit<K extends 'frames' | 'notes'>(m: MapView, key: K, id: string, item: Partial<NonNullable<MapView[K]>[number]> | null) {
  const list = (m[key] ?? []) as MapNode[], old = list.find((i) => i.id === id)
  return tidyMap({ ...m, [key]: [...list.filter((i) => i.id !== id), ...(item ? [{ ...old, ...item, id }] : [])] })
}

/** Moves frames and notes by id (cards go through `place`). */
export const moveItems = (m: MapView, at: Record<string, { x: number; y: number }>) =>
  tidyMap({ ...m, frames: m.frames?.map((f) => (at[f.id] ? { ...f, ...at[f.id] } : f)), notes: m.notes?.map((n) => (at[n.id] ? { ...n, ...at[n.id] } : n)) })

/** The nearest spot to (x, y) where a card overlaps no card or note. */
export function freeSpot(m: MapView, x: number, y: number) {
  const rects = [...(m.nodes ?? []).map((n) => [n.x, n.y, CARD_W, CARD_H]), ...(m.notes ?? []).map((n) => [n.x, n.y, NOTE_W, NOTE_H])]
  const clear = (px: number, py: number) => rects.every(([rx, ry, rw, rh]) => px + CARD_W + 16 <= rx || rx + rw + 16 <= px || py + CARD_H + 16 <= ry || ry + rh + 16 <= py)
  for (let r = 0; r < 60; r++) for (let i = -r; i <= r; i++) for (const [dx, dy] of [[i, -r], [r, i], [-i, r], [-r, -i]]) {
    if (clear(x + dx * 40, y + dy * 40)) return { x: Math.round(x + dx * 40), y: Math.round(y + dy * 40) }
  }
  return { x: Math.round(x), y: Math.round(y) }
}

export type Align = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom' | 'across' | 'down'
/** New positions that line cards up on one edge or centre, or space them evenly across or down. */
export function align(m: MapView, ids: string[], how: Align): At {
  const ns = (m.nodes ?? []).filter((n) => ids.includes(n.id))
  if (ns.length < 2) return {}
  const xs = ns.map((n) => n.x), ys = ns.map((n) => n.y), [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const even = (axis: 'x' | 'y', lo: number, hi: number) => [...ns].sort((a, b) => a[axis] - b[axis]).map((n, i) => [n.id, { ...n, [axis]: lo + ((hi - lo) * i) / (ns.length - 1) }])
  const set = (f: (n: MapNode) => Partial<MapNode>) => ns.map((n) => [n.id, { x: n.x, y: n.y, ...f(n) }])
  const pairs = { left: () => set(() => ({ x: x0 })), center: () => set(() => ({ x: (x0 + x1) / 2 })), right: () => set(() => ({ x: x1 })),
    top: () => set(() => ({ y: y0 })), middle: () => set(() => ({ y: (y0 + y1) / 2 })), bottom: () => set(() => ({ y: y1 })),
    across: () => even('x', x0, x1), down: () => even('y', y0, y1) }[how]()
  return Object.fromEntries(pairs.map(([id, p]) => [id, { x: Math.round((p as MapNode).x), y: Math.round((p as MapNode).y) }]))
}

/** Three-way merge by id: a change on either side wins over the base; when both changed one item, ours is kept and named. */
export function mergeMaps(base: MapView, ours: MapView, theirs: MapView) {
  const out: MapView = {}, clashes: string[] = []
  for (const k of KEYS) {
    const ix = (m: MapView) => new Map((m[k] ?? []).map((i) => [i.id, JSON.stringify(i)]))
    const [b, o, t] = [ix(base), ix(ours), ix(theirs)]
    out[k] = [...new Set([...o.keys(), ...t.keys(), ...b.keys()])].flatMap((id) => {
      const [bi, oi, ti] = [b.get(id), o.get(id), t.get(id)]
      const v = oi === ti ? oi : oi === bi ? ti : ti === bi ? oi : (clashes.push(id), oi ?? ti)
      return v ? [JSON.parse(v)] : []
    }) as never
  }
  return { map: tidyMap(out), clashes }
}

/**
 * The one-time move from the version 1 grid: every placed quest gets the position the grid gave it, and each act a frame
 * around its columns, so the first free-form map looks like the last grid. Deterministic: two designers converting the
 * same lore write the same file.
 */
export function migrateMap(pages: Data[], v1: MapView = {}): MapView {
  const by = (t: string) => pages.filter((p) => p.type === t).sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || `${a.code ?? ''} ${a.title}`.localeCompare(`${b.code ?? ''} ${b.title}`))
  const CW = 270, GAP = 14, PAD = 18, TOP = 56
  const acts = by('act'), lines = by('questline')
  const cols = acts.flatMap((a) => { const subs: string[] = (a.subsections ?? []).filter(Boolean); return (subs.length ? subs : ['']).map((sub) => ({ act: a.id, sub })) })
  const emergent = new Set(lines.filter((l) => l.kind === 'emergent').map((l) => l.id))
  const lanes = [...lines.filter((l) => !emergent.has(l.id)).map((l) => l.id), '']
  const cells = new Map<string, Data[]>(), band: Data[] = []
  for (const q of by('quest')) {
    if (emergent.has(q.questline)) { band.push(q); continue }
    const inAct = cols.filter((c) => c.act === q.act)
    if (!inAct.length) continue
    const col = inAct.find((c) => c.sub === (q.subsection ?? '')) ?? inAct[0]
    const key = `${col.act}|${col.sub}|${lanes.includes(q.questline) ? q.questline : ''}`
    cells.set(key, [...(cells.get(key) ?? []), q])
  }
  for (const [key, list] of cells) { const o = v1.cells?.[key] ?? []; list.sort((a, b) => (o.indexOf(a.id) + 1 || 1e6) - (o.indexOf(b.id) + 1 || 1e6)) }
  const nodes: MapNode[] = []
  let y = TOP
  for (const lane of lanes) {
    const n = Math.max(0, ...cols.map((c) => cells.get(`${c.act}|${c.sub}|${lane}`)?.length ?? 0))
    if (!n) continue
    cols.forEach((c, ci) => (cells.get(`${c.act}|${c.sub}|${lane}`) ?? []).forEach((q, k) => nodes.push({ id: q.id, x: ci * CW + 20, y: y + PAD + k * (CARD_H + GAP) })))
    y += PAD * 2 + n * (CARD_H + GAP) - GAP
  }
  band.forEach((q, k) => nodes.push({ id: q.id, x: k * (CARD_W + GAP) + 20, y: y + 40 }))
  const frames = acts.flatMap((a, i): MapFrame[] => {
    const span = cols.flatMap((c, ci) => (c.act === a.id ? [ci] : []))
    if (!span.length || !nodes.some((n) => pages.find((p) => p.id === n.id)?.act === a.id)) return []
    return [{ id: `f_${a.id}`, label: `Act ${roman(a.order ?? 0)} · ${a.title}`, x: span[0] * CW + 6, y: 0, w: span.length * CW - 12, h: y + 8, color: (i % 6) + 1 }]
  })
  return tidyMap({ nodes, frames })
}

/** JSON Canvas 1.0 (jsoncanvas.org), the Obsidian Canvas format: frames as groups, quests as file nodes, notes as text. */
export interface Link { from: string; to: string; label?: string }
export function toCanvas(m: MapView, files: Record<string, string>, links: Link[]) {
  const placed = new Set((m.nodes ?? []).map((n) => n.id))
  const nodes = [
    ...(m.frames ?? []).map((f) => ({ id: f.id, type: 'group', label: f.label, x: f.x, y: f.y, width: f.w, height: f.h, ...(f.color ? { color: String(f.color) } : {}) })),
    ...(m.nodes ?? []).filter((n) => files[n.id]).map((n) => ({ id: n.id, type: 'file', file: files[n.id], x: n.x, y: n.y, width: CARD_W, height: CARD_H })),
    ...(m.notes ?? []).map((n) => ({ id: n.id, type: 'text', text: n.text, x: n.x, y: n.y, width: n.w ?? NOTE_W, height: n.h ?? NOTE_H })),
  ]
  const edges = links.filter((l) => placed.has(l.from) && placed.has(l.to))
    .map((l, i) => ({ id: `e${i}`, fromNode: l.from, fromSide: 'right', toNode: l.to, toSide: 'left', ...(l.label ? { label: l.label, color: '1' } : {}) }))
  const lines = (xs: object[]) => xs.map((x) => `\t\t${JSON.stringify(x)}`).join(',\n')
  return `{\n\t"nodes":[\n${lines(nodes)}\n\t],\n\t"edges":[\n${lines(edges)}\n\t]\n}\n`
}
/** Positions from a JSON Canvas file: file nodes that point at a page (by path) place that quest; groups and text come in as frames and notes. */
export function fromCanvas(text: string, ids: Record<string, string>): MapView {
  const c = JSON.parse(text) as { nodes?: { id: string; type: string; x: number; y: number; width: number; height: number; file?: string; label?: string; text?: string; color?: string }[] }
  const ns = c.nodes ?? []
  return tidyMap({
    nodes: ns.filter((n) => n.type === 'file' && n.file && ids[n.file]).map((n) => ({ id: ids[n.file!], x: n.x, y: n.y })),
    frames: ns.filter((n) => n.type === 'group').map((n) => ({ id: `f_${n.id}`.replace(/^f_f_/, 'f_'), label: n.label ?? '', x: n.x, y: n.y, w: n.width, h: n.height, ...(+(n.color ?? 0) >= 1 && +(n.color ?? 0) <= 6 ? { color: +n.color! } : {}) })),
    notes: ns.filter((n) => n.type === 'text').map((n) => ({ id: `n_${n.id}`.replace(/^n_n_/, 'n_'), text: n.text ?? '', x: n.x, y: n.y,
      ...(n.width !== NOTE_W || n.height !== NOTE_H ? { w: n.width, h: n.height } : {}) })),
  })
}
