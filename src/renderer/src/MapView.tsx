// The quest map: one free canvas. Quests sit where the designer puts them (views/map.yaml); areas and notes are drawn on
// it; links come from the lore. Acts and questlines show as colours and badges on the cards, never as layout.
// (Areas are stored as `frames` in the map file.)
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { create } from 'zustand'
import {
  ReactFlow, Handle, Position, MiniMap, Controls, ViewportPortal, MarkerType, NodeResizer, NodeToolbar, SelectionMode, applyNodeChanges, useReactFlow, useStore as useFlow,
  type Node, type Edge, type NodeProps, type NodeChange, type NodePositionChange, type Connection, type FinalConnectionState,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  useStore, update, peek, openFull, writeMap, placeCards, toast, toggleFilter, batch, lastChange, undo, trashPages, pick, targets, unplace, setStatus,
  createQuest, setMiddle, duplicateAll, type MenuItem,
} from './store'
import { call } from './api'
import { byType, label, links, type QuestLink } from './derive'
import { addPayoff, branches, refsOf, removePayoff, type Data } from '../../shared/page'
import { questState, stateLabel, type EngineIndex } from '../../shared/engine'
import { kindStyle, openMenu, pageMenu } from './ui'
import { CARD_H, CARD_W, NOTE_H, NOTE_W, align, edit, fromCanvas, moveItems, place, toCanvas, type Align, type MapFrame, type MapNote, type MapView as MapData } from '../../shared/map'
import { STATUSES, STATUS_LABEL, type Row, type Schema } from '../../shared/schema'
import { layered } from './tidy'

/** Six colours, by act order for card stripes and by choice for areas and notes: [stripe, fill, edge, name]. */
const COLORS = [['#9a3b22', '#f3e6df', '#c48a72', 'Rust'], ['#2c5d74', '#e2ecf1', '#7fa3b6', 'Blue'], ['#4f7a48', '#e5eee2', '#87a97f', 'Green'],
  ['#7a5ea8', '#ece6f3', '#a08bbd', 'Violet'], ['#a07d2c', '#f3ecd9', '#c4a35a', 'Ochre'], ['#9a5574', '#f3e5ec', '#b98aa0', 'Rose']]
const NOTE_FILL = '#f3e3a6'
const TONE: Record<string, string> = { idea: '#b9b2a4', outline: '#8fa8b8', draft: '#c4a35a', review: '#8a6fb0', ready: '#4f8a4a', cut: '#999' }
const S = useStore.getState

/** What only the map needs: selected areas and notes, the one being edited in place, and the drawing tool in hand. */
const useUi = create<{ picked: string[]; editing: string | null; tool: 'area' | 'note' | null }>(() => ({ picked: [], editing: null, tool: null }))
const U = useUi.getState

type Card = { code?: string; title: string; synopsis: string; status: string; stripe: string; line?: string; chips: [string, string, string?][]; branches: string[]; needs?: string; badges: string[]; dim: boolean }
type Area = { label: string; color: number }
type Note = { text: string; color: number }

const QuestCard = memo(({ data, selected }: NodeProps<Node<Card>>) => {
  const level = useFlow((s) => (s.transform[2] < 0.55 ? 'far' : s.transform[2] > 1.3 ? 'near' : 'mid'))
  return <>
    <Handle type="target" position={Position.Left} />
    <div className={`card z-${level}${data.dim ? ' dim' : ''}${selected ? ' sel' : ''}${data.needs ? ' needs' : ''}`} style={{ borderTopColor: data.stripe }}
      title={[[data.code, data.title].filter(Boolean).join(' '), data.synopsis, data.needs].filter(Boolean).join('\n')}>
      {level === 'far' ? <div className="card-far">{data.code || data.title || 'Untitled'}</div> : <>
        <div className="card-head"><b>{data.code}</b> {data.title || <i className="muted">Untitled</i>}</div>
        <div className="card-syn">{data.synopsis}</div>
        <div className="card-meta"><span className="dot" style={{ background: TONE[data.status] }} />{STATUS_LABEL[data.status as keyof typeof STATUS_LABEL]}
          {data.line && <span className="line" title="Questline">{data.line}</span>}
          {data.badges.map((b) => <span key={b} className="badge-mini" title={b === 'Hub' ? 'Three or more links lead out' : 'Three or more links lead in'}>{b}</span>)}</div>
        <div className="card-chips">{data.chips.slice(0, level === 'near' ? 8 : 3).map(([c, t, color]) =>
          <span key={c} className="mini-chip" style={{ '--kc': color } as React.CSSProperties} onClick={(e) => { e.stopPropagation(); toggleFilter(c, e.shiftKey) }}>{t}</span>)}
          {data.chips.length > 3 && level === 'mid' && <span className="more">+{data.chips.length - 3}</span>}</div>
        {level === 'near' && <ul className="card-branches">{data.branches.map((b) => <li key={b}>{b}</li>)}</ul>}
      </>}
    </div>
    <Handle type="source" position={Position.Right} />
  </>
})

/** Text edited where it stands: Enter (Ctrl+Enter in a note) or a click away keeps it, Escape puts back what was there. */
function Inline({ value, multi, className, onDone }: { value: string; multi?: boolean; className: string; onDone: (v: string) => void }) {
  const cancel = useRef(false)
  const props = {
    className: `${className} nodrag nowheel`, autoFocus: true, defaultValue: value, spellCheck: true,
    onFocus: (e: React.FocusEvent<HTMLInputElement & HTMLTextAreaElement>) => e.target.select(),
    onBlur: (e: React.FocusEvent<HTMLInputElement & HTMLTextAreaElement>) => { useUi.setState({ editing: null }); onDone(cancel.current ? value : e.target.value) },
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement & HTMLTextAreaElement>) => {
      e.stopPropagation()
      if (e.key === 'Escape') { cancel.current = true; e.currentTarget.blur() }
      if (e.key === 'Enter' && (!multi || e.ctrlKey || e.metaKey)) { e.preventDefault(); e.currentTarget.blur() }
    },
  }
  return multi ? <textarea {...props} /> : <input {...props} />
}

function Swatches({ id, kind, current }: { id: string; kind: 'frames' | 'notes'; current: number }) {
  return <span className="swatches">{[...(kind === 'notes' ? [0] : []), 1, 2, 3, 4, 5, 6].map((i) =>
    <button key={i} title={i ? COLORS[i - 1][3] : 'Yellow'} className={`swatch${current === i ? ' on' : ''}`} style={{ background: i ? COLORS[i - 1][1] : NOTE_FILL, borderColor: i ? COLORS[i - 1][2] : '#c9b766' }}
      onClick={() => writeMap(edit(S().map, kind, id, { color: i || undefined }), 'Change a colour')} />)}</span>
}

const AreaNode = memo(({ id, data, selected }: NodeProps<Node<Area>>) => {
  const editing = useUi((s) => s.editing === id)
  const c = COLORS[(data.color - 1) % 6]
  return <>
    <NodeResizer isVisible={selected && !editing} minWidth={200} minHeight={120} color={c[2]}
      onResizeEnd={(_, p) => writeMap(edit(S().map, 'frames', id, { x: p.x, y: p.y, w: p.width, h: p.height }), `Resize ${data.label || 'an area'}`)} />
    <NodeToolbar isVisible={selected && !editing} className="node-tools" style={{ zIndex: 1000 }}>
      <Swatches id={id} kind="frames" current={data.color} />
      <button onClick={() => useUi.setState({ editing: id })}>Rename</button><button onClick={() => fitArea(id)}>Fit to its cards</button>
      <button className="danger" onClick={() => removeItems([id])}>Delete</button>
    </NodeToolbar>
    <div className={`frame${selected ? ' on' : ''}`} style={{ background: c[1], borderColor: c[2] }}>
      {editing ? <Inline value={data.label} className="frame-input" onDone={(v) => commit(id, 'frames', 'label', v.trim())} />
        : <div className="frame-label" title="Double-click to rename" onDoubleClick={(e) => { e.stopPropagation(); useUi.setState({ editing: id }) }}>{data.label || 'Area'}</div>}
    </div>
  </>
})

const NoteNode = memo(({ id, data, selected }: NodeProps<Node<Note>>) => {
  const editing = useUi((s) => s.editing === id)
  return <>
    <NodeResizer isVisible={selected && !editing} minWidth={140} minHeight={60} color="#b3a46a"
      onResizeEnd={(_, p) => writeMap(edit(S().map, 'notes', id, { x: p.x, y: p.y, w: p.width, h: p.height }), 'Resize a note')} />
    <NodeToolbar isVisible={selected && !editing} className="node-tools" style={{ zIndex: 1000 }}>
      <Swatches id={id} kind="notes" current={data.color} />
      <button onClick={() => useUi.setState({ editing: id })}>Edit</button><button className="danger" onClick={() => removeItems([id])}>Delete</button>
    </NodeToolbar>
    <div className={`note${selected ? ' sel' : ''}`} style={{ background: data.color ? COLORS[(data.color - 1) % 6][1] : NOTE_FILL }} onDoubleClick={(e) => { e.stopPropagation(); useUi.setState({ editing: id }) }}>
      {editing ? <Inline value={data.text} multi className="note-input" onDone={(v) => commit(id, 'notes', 'text', v)} /> : data.text || <i className="muted">Empty note</i>}
    </div>
  </>
})
const nodeTypes = { quest: QuestCard, frame: AreaNode, note: NoteNode }

const done = (text: string) => { const c = lastChange(); toast(text, { label: 'Undo', run: () => undo(c) }) }
let seq = 0
const newId = (p: string) => `${p}_${Date.now().toString(36)}${(seq++ % 36).toString(36)}`
const quests = (ns: Node[]) => ns.filter((n) => n.type === 'quest').map((n) => n.id)
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`
type Rect = { x: number; y: number; w: number; h: number }

/** Keeps an in-place edit. An empty new note is dropped rather than kept. */
function commit(id: string, kind: 'frames' | 'notes', key: 'label' | 'text', v: string) {
  const item = (S().map[kind] as (MapFrame | MapNote)[] | undefined)?.find((x) => x.id === id) as Record<string, unknown> | undefined
  if (!item) return
  if (kind === 'notes' && !v.trim()) return removeItems([id])
  if (v !== item[key]) writeMap(edit(S().map, kind, id, { [key]: v }), kind === 'frames' ? `Rename ${item.label || 'an area'}` : 'Edit a note')
}
function removeItems(ids: string[]) {
  let m = S().map
  for (const id of ids) m = edit(m, m.frames?.some((f) => f.id === id) ? 'frames' : 'notes', id, null)
  writeMap(m, ids.length > 1 ? `Delete ${ids.length} items` : ids[0].startsWith('f_') ? 'Delete an area' : 'Delete a note')
  useUi.setState({ picked: [] })
}
/** A new area, selected and ready to be named. */
function addArea(r: Rect) {
  const id = newId('f'), color = ((S().map.frames?.length ?? 0) % 6) + 1
  writeMap(edit(S().map, 'frames', id, { label: '', ...r, color }), 'Add an area')
  useUi.setState({ picked: [id], editing: id })
  useStore.setState({ selected: null, multi: [] })
}
function addNote(at: { x: number; y: number }) {
  const id = newId('n')
  writeMap(edit(S().map, 'notes', id, { text: '', x: at.x, y: at.y }), 'Add a note')
  useUi.setState({ picked: [id], editing: id })
}
const box = (m: MapData, ids: string[]) => {
  const rs = [...(m.nodes ?? []).filter((n) => ids.includes(n.id)).map((n) => ({ x: n.x, y: n.y, w: CARD_W, h: CARD_H })),
    ...(m.notes ?? []).filter((n) => ids.includes(n.id)).map((n) => ({ x: n.x, y: n.y, w: n.w ?? NOTE_W, h: n.h ?? NOTE_H }))]
  if (!rs.length) return null
  const [x0, y0] = [Math.min(...rs.map((r) => r.x)), Math.min(...rs.map((r) => r.y))]
  return { x: x0, y: y0, w: Math.max(...rs.map((r) => r.x + r.w)) - x0, h: Math.max(...rs.map((r) => r.y + r.h)) - y0 }
}
/** An area around cards and notes, with room for its name. */
function areaAround(ids: string[]) {
  const b = box(S().map, ids)
  if (!b) return toast('Select the cards to put in an area first.')
  addArea({ x: b.x - 32, y: b.y - 64, w: b.w + 64, h: b.h + 96 })
}
/** Cards and notes whose middle is inside an area, and smaller areas wholly inside it. */
function inside(m: MapData, f: Rect) {
  const mid = (x: number, y: number, w: number, h: number) => x + w / 2 > f.x && x + w / 2 < f.x + f.w && y + h / 2 > f.y && y + h / 2 < f.y + f.h
  return [
    ...(m.nodes ?? []).filter((n) => mid(n.x, n.y, CARD_W, CARD_H)).map((n) => n.id),
    ...(m.notes ?? []).filter((n) => mid(n.x, n.y, n.w ?? NOTE_W, n.h ?? NOTE_H)).map((n) => n.id),
    ...(m.frames ?? []).filter((g) => g.w * g.h < f.w * f.h && g.x >= f.x && g.y >= f.y && g.x + g.w <= f.x + f.w && g.y + g.h <= f.y + f.h).map((g) => g.id),
  ]
}
const areaOf = (id: string) => S().map.frames?.find((f) => f.id === id)
/** The smallest area under a point. An area's empty inside belongs to the canvas, so a drag there still draws a selection
 *  box; a click there picks the area, and a picked area can be dragged anywhere and resized. */
const areaAt = (p: { x: number; y: number }) => (S().map.frames ?? []).filter((f) => p.x > f.x && p.x < f.x + f.w && p.y > f.y && p.y < f.y + f.h)
  .sort((a, b) => a.w * a.h - b.w * b.h)[0]?.id
function fitArea(id: string) {
  const f = areaOf(id), b = f && box(S().map, inside(S().map, f))
  if (!f || !b) return toast('This area has no cards in it.')
  writeMap(edit(S().map, 'frames', id, { x: b.x - 32, y: b.y - 64, w: b.w + 64, h: b.h + 96 }), `Fit ${f.label || 'an area'} to its cards`)
}

const linkPairs = () => links(S().schema, S().pages).map((l): [string, string] => [l.from, l.to])
/** ELK layout of a selection, put where the selection was. */
async function tidy(ids: string[]) {
  const ns = (S().map.nodes ?? []).filter((n) => ids.includes(n.id))
  if (ns.length < 2) return toast('Select two or more cards to tidy.')
  const at = clear(await layered(ns.map((n) => n.id), linkPairs(), new Map(ns.map((n) => [n.id, n])), { x: Math.min(...ns.map((n) => n.x)), y: Math.min(...ns.map((n) => n.y)) }))
  placeCards(at, `Tidy ${plural(ns.length, 'quest')}`)
  done(`Tidied ${plural(ns.length, 'quest')}`)
}
/** Moves a laid-out group down until it overlaps no card outside it. */
function clear(at: Record<string, { x: number; y: number }>) {
  const others = (S().map.nodes ?? []).filter((n) => !(n.id in at)), ps = Object.values(at)
  for (let i = 0; i < 20; i++) {
    const [x0, y0, x1, y1] = [Math.min(...ps.map((p) => p.x)), Math.min(...ps.map((p) => p.y)), Math.max(...ps.map((p) => p.x)) + CARD_W, Math.max(...ps.map((p) => p.y)) + CARD_H]
    const hit = others.filter((o) => o.x < x1 + 16 && o.x + CARD_W + 16 > x0 && o.y < y1 + 16 && o.y + CARD_H + 16 > y0)
    if (!hit.length) break
    const dy = Math.max(...hit.map((o) => o.y + CARD_H)) + 40 - y0
    for (const p of ps) p.y += dy
  }
  return at
}
/** Lays out every quest still in Hooks, to the right of everything on the map. */
export async function placeAll() {
  const s = S(), on = new Set((s.map.nodes ?? []).map((n) => n.id))
  const ids = byType(s.pages, 'quest').filter((q) => !on.has(q.data.id) && q.data.status !== 'cut').map((q) => q.data.id)
  if (!ids.length) return toast('Every quest is on the map.')
  const all = [...(s.map.nodes ?? []), ...(s.map.frames ?? []).map((f) => ({ ...f, x: f.x + f.w - CARD_W }))]
  const origin = all.length ? { x: Math.max(...all.map((n) => n.x)) + CARD_W + 160, y: Math.min(...all.map((n) => n.y)) } : { x: 0, y: 0 }
  placeCards(clear(await layered(ids, linkPairs(), new Map(), origin)), `Place ${plural(ids.length, 'quest')} from Hooks`)
  done(`Placed ${plural(ids.length, 'quest')} from Hooks`)
  window.dispatchEvent(new Event('qn:fit'))
}
export async function exportCanvas() {
  const s = S(), files = Object.fromEntries(Object.values(s.pages).map((p) => [p.data.id, p.file]))
  const text = toCanvas(s.map, files, links(s.schema, s.pages).map((l) => ({ from: l.from, to: l.to, label: l.kind === 'payoff' ? l.condition : undefined })))
  const path = await call('canvas:save', text, s.project?.config.name ?? 'map')
  if (path) toast(`Exported the map to ${path}`)
}
export async function importCanvas() {
  const text = await call('canvas:open')
  if (!text) return
  try {
    const got = fromCanvas(text, Object.fromEntries(Object.values(S().pages).map((p) => [p.file, p.data.id]))), m = S().map
    const keep = <T extends { id: string }>(a: T[] = [], b: T[] = []) => [...a.filter((x) => !b.some((y) => y.id === x.id)), ...b]
    writeMap({ nodes: keep(m.nodes, got.nodes), frames: keep(m.frames, got.frames), notes: keep(m.notes, got.notes) }, 'Import a layout')
    done(`Placed ${plural(got.nodes?.length ?? 0, 'quest')} from the canvas file`)
  } catch (e) { toast(`Could not read that canvas file: ${e}`) }
}

// Copy, paste and duplicate: cards become new quests (links among them follow), areas and notes new items, all one undo step.
let clip: { quests: string[]; frames: MapFrame[]; notes: MapNote[] } | null = null
const chosen = () => { const m = S().map, p = U().picked; return { quests: targets().filter((id) => m.nodes?.some((n) => n.id === id)), frames: (m.frames ?? []).filter((f) => p.includes(f.id)), notes: (m.notes ?? []).filter((n) => p.includes(n.id)) } }
async function paste(c: NonNullable<typeof clip>, to?: { x: number; y: number }, verb = 'Paste') {
  const n = c.quests.length + c.frames.length + c.notes.length
  if (!n) return
  const pts = [...(S().map.nodes ?? []).filter((q) => c.quests.includes(q.id)), ...c.frames, ...c.notes]
  const [dx, dy] = to && pts.length ? [Math.round(to.x - Math.min(...pts.map((p) => p.x))), Math.round(to.y - Math.min(...pts.map((p) => p.y)))] : [40, 40]
  await batch(`${verb} ${plural(n, 'item')}`, async () => {
    const made = await duplicateAll(c.quests, dx, dy)
    let next = S().map
    const picked: string[] = []
    for (const f of c.frames) { const id = newId('f'); picked.push(id); next = edit(next, 'frames', id, { ...f, id, x: f.x + dx, y: f.y + dy }) }
    for (const t of c.notes) { const id = newId('n'); picked.push(id); next = edit(next, 'notes', id, { ...t, id, x: t.x + dx, y: t.y + dy }) }
    if (picked.length) writeMap(next)
    const qs = [...made.values()]
    useStore.setState({ selected: qs[qs.length - 1] ?? null, multi: qs.length > 1 ? qs : [] })
    useUi.setState({ picked })
  })
  done(`${verb === 'Paste' ? 'Pasted' : 'Duplicated'} ${plural(n, 'item')}`)
}
const duplicateSel = () => paste(chosen(), undefined, 'Duplicate')

/** The menu for a card: with several picked, what can be done to all of them. */
function cardMenu(id: string): MenuItem[] {
  const many = S().multi.length > 1 && S().multi.includes(id) ? targets() : null
  if (!many) return [...pageMenu(id).slice(0, -2), { label: 'Put in a new area', key: 'Ctrl G', run: () => areaAround([id]) },
    { label: 'Move to Hooks', run: () => unplace([id]) }, ...pageMenu(id).slice(-2)]
  const al = (how: Align, text: string): MenuItem => ({ label: text, run: () => placeCards(align(S().map, many, how), `${text} ${many.length} quests`) })
  return [
    ...STATUSES.map((st, i): MenuItem => ({ label: `Set ${many.length} to ${STATUS_LABEL[st]}`, key: i < 5 ? String(i + 1) : undefined, run: () => setStatus(many, st, STATUS_LABEL[st]) })),
    '-', al('left', 'Align left'), al('center', 'Align centres'), al('right', 'Align right'), al('top', 'Align tops'), al('middle', 'Align middles'), al('bottom', 'Align bottoms'),
    al('across', 'Space evenly across'), al('down', 'Space evenly down'),
    '-', { label: `Tidy ${many.length} quests`, run: () => tidy(many) }, { label: 'Put them in a new area', key: 'Ctrl G', run: () => areaAround(many) },
    { label: 'Duplicate', key: 'Ctrl D', run: duplicateSel },
    '-', { label: `Move ${many.length} to Hooks`, run: () => unplace(many) },
    { label: `Move ${many.length} to Trash`, key: 'Del', danger: true, run: () => trashPages(many) },
  ]
}
function areaMenu(id: string): MenuItem[] {
  const f = areaOf(id)
  if (!f) return []
  const cards = inside(S().map, f).filter((x) => S().pages[x])
  return [
    { label: 'Rename', run: () => useUi.setState({ editing: id }) },
    ...COLORS.map((c, i): MenuItem => ({ label: c[3], on: (f.color ?? 1) === i + 1, run: () => writeMap(edit(S().map, 'frames', id, { color: i + 1 }), `Colour ${f.label || 'an area'}`) })),
    '-', { label: `Select its ${plural(cards.length, 'card')}`, run: () => { useStore.setState({ multi: cards.length > 1 ? cards : [], selected: cards[0] ?? null }); useUi.setState({ picked: [] }) } },
    { label: 'Tidy its cards', run: () => tidy(cards) }, { label: 'Fit to its cards', run: () => fitArea(id) },
    '-', { label: 'Delete the area (cards stay)', key: 'Del', danger: true, run: () => removeItems([id]) },
  ]
}

const size = (n: Node) => ({ w: n.width ?? n.measured?.width ?? CARD_W, h: n.height ?? n.measured?.height ?? CARD_H })
/** Snaps a dragged item to the nearest edge or centre of another within a few pixels, and says where the guide lines are. */
function guideSnap(me: Node, pos: { x: number; y: number }, all: Node[], zoom: number) {
  const { w, h } = size(me), T = 6 / zoom
  let bx = { d: T, at: pos.x, line: undefined as number | undefined }, by = { d: T, at: pos.y, line: undefined as number | undefined }
  for (const o of all) {
    if (o.id === me.id || o.selected || (o.type === 'frame') !== (me.type === 'frame')) continue
    const s = size(o)
    for (const line of [o.position.x, o.position.x + s.w / 2, o.position.x + s.w]) for (const off of [0, w / 2, w]) {
      const d = Math.abs(pos.x + off - line); if (d < bx.d) bx = { d, at: line - off, line }
    }
    for (const line of [o.position.y, o.position.y + s.h / 2, o.position.y + s.h]) for (const off of [0, h / 2, h]) {
      const d = Math.abs(pos.y + off - line); if (d < by.d) by = { d, at: line - off, line }
    }
  }
  return { pos: { x: bx.at, y: by.at }, guides: { x: bx.line, y: by.line } }
}

export function MapView() {
  const { pages, map, engine, selected, multi, filters, text, payoffs, schema, project } = useStore()
  const { picked, tool } = useUi()
  const flow = useReactFlow()
  const [edgeSel, setEdgeSel] = useState<string | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const [guides, setGuides] = useState<{ x?: number; y?: number } | null>(null)
  const [menu, setMenu] = useState<{ source: string; target: string; x: number; y: number } | null>(null)
  const [snap, setSnap] = useState(() => { try { return localStorage.getItem('qn.snap') !== 'off' } catch { return true } })
  const [keys, setKeys] = useState({ alt: false, shift: false })
  const pointer = useRef<{ x: number; y: number } | null>(null)
  const cut = filters.includes('status:cut')
  const matches = useCallback((q: Data) => matchQuest(schema, pages, q, filters, text, engine), [schema, pages, filters, text, engine])
  const all = useMemo(() => links(schema, pages), [schema, pages])
  const at = useMemo(() => new Map((map.nodes ?? []).filter((n) => pages[n.id]?.data.type === 'quest' && (cut || pages[n.id].data.status !== 'cut')).map((n) => [n.id, n])), [map, pages, cut])

  /** Areas (largest first, so smaller ones sit on top), cards and notes as React Flow nodes. A node object is reused while
   *  nothing about it changed, so React Flow redraws only what did. */
  const cache = useRef(new Map<string, Node>())
  const laid = useMemo(() => {
    const sel = new Set(multi.length ? multi : selected ? [selected] : [])
    const out = new Map(all.map((l) => [l.from, 0])), into = new Map(all.map((l) => [l.to, 0]))
    for (const l of all) { out.set(l.from, out.get(l.from)! + 1); into.set(l.to, into.get(l.to)! + 1) }
    const acts = byType(pages, 'act').map((a) => a.data.id)
    const card = (q: Data): Card => {
      const chips = [...new Set(schema.fields.quest.filter((f) => f.kind === 'rows' && f.key !== 'leads_to').sort((a, b) => +!!b.giver - +!!a.giver)
        .flatMap((f) => (q[f.key] ?? []) as Row[]).filter((r) => r.ref && pages[r.ref]).map((r) => r.ref!))]
      const state = questState(q, engine), ai = acts.indexOf(q.act)
      return {
        code: q.code, title: q.title, status: q.status ?? 'idea', stripe: ai >= 0 ? COLORS[ai % 6][0] : '#b9b2a4', line: pages[q.questline]?.data.title,
        synopsis: q.synopsis || /^(?!#|\||>|\s*$)(.+)$/m.exec(pages[q.id].body)?.[1]?.replace(/\[\[[^\]|]+\|?([^\]]*)\]\]/g, '$1') || '',
        chips: chips.map((c) => [c, pages[c].data.title, (kindStyle(schema, pages[c].data.type) as Record<string, string>)['--kc']]),
        branches: branches(pages[q.id].body, schema.branches).filter((b) => b.condition).slice(0, 4).map((b) => b.condition),
        needs: state === 'needs' ? `Ready, and not yet in ${schema.engine?.name}` : undefined, dim: !matches(q),
        badges: [...((out.get(q.id) ?? 0) >= 3 ? ['Hub'] : []), ...((into.get(q.id) ?? 0) >= 3 ? ['Bottleneck'] : [])],
      }
    }
    const nodes: Node[] = [
      ...[...(map.frames ?? [])].sort((a, b) => b.w * b.h - a.w * a.h).map((f): Node => ({ id: f.id, type: 'frame', position: { x: f.x, y: f.y }, width: f.w, height: f.h, zIndex: -1,
        connectable: false, selected: picked.includes(f.id), data: { label: f.label, color: f.color ?? 1 } })),
      ...[...at.values()].map((n): Node => ({ id: n.id, type: 'quest', position: { x: n.x, y: n.y }, width: CARD_W, height: CARD_H, selected: sel.has(n.id), data: card(pages[n.id].data) })),
      ...(map.notes ?? []).map((n): Node => ({ id: n.id, type: 'note', position: { x: n.x, y: n.y }, width: n.w ?? NOTE_W, height: n.h ?? NOTE_H, connectable: false, selected: picked.includes(n.id), data: { text: n.text, color: n.color ?? 0 } })),
    ]
    const same = (a: Node, b: Node) => a.position.x === b.position.x && a.position.y === b.position.y && a.selected === b.selected && a.width === b.width && a.height === b.height && JSON.stringify(a.data) === JSON.stringify(b.data)
    const next = nodes.map((n) => { const old = cache.current.get(n.id); return old && same(old, n) ? old : n })
    cache.current = new Map(next.map((n) => [n.id, n]))
    return next
  }, [map, at, pages, schema, engine, all, matches, selected, multi, picked])
  const [nodes, setNodes] = useState(laid)
  const live = useRef(nodes)
  useEffect(() => { live.current = laid; setNodes(laid) }, [laid])

  const edges: Edge<QuestLink>[] = useMemo(() => all.filter((l) => at.has(l.from) && at.has(l.to)).map((l) => {
    const id = l.kind === 'leads' ? `l|${l.from}|${l.to}` : `p|${l.from}|${l.line}|${l.to}`
    const hot = [hover, selected].some((x) => x && (x === l.from || x === l.to)) || id === edgeSel
    return {
      id, source: l.from, target: l.to, className: `${l.kind}${hot ? ' hot' : ''}`, data: l, selected: id === edgeSel, reconnectable: true,
      hidden: l.kind === 'payoff' && !payoffs && !hot, label: l.kind === 'payoff' && hot ? l.condition : undefined, markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
    }
  }), [all, at, hover, selected, edgeSel, payoffs])

  // Dragging: magnetic guides while one item moves; an area carries what sits inside it; everything moved is one undo step.
  const carry = useRef<{ anchor: string; from: { x: number; y: number }; start: Map<string, { x: number; y: number }> } | null>(null)
  const onNodesChange = useCallback((changes: NodeChange<Node>[]) => {
    const moving = changes.filter((c): c is NodePositionChange => c.type === 'position' && !!c.dragging && !!c.position)
    if (moving.length === 1 && !keys.alt) {
      const me = live.current.find((n) => n.id === moving[0].id)
      if (me) { const g = guideSnap(me, moving[0].position!, live.current, flow.getZoom()); moving[0].position = g.pos; setGuides(g.guides.x !== undefined || g.guides.y !== undefined ? g.guides : null) }
    }
    let next = applyNodeChanges(changes, live.current)
    const c = carry.current, a = c && moving.find((m) => m.id === c.anchor)
    if (c && a) {
      const dx = a.position!.x - c.from.x, dy = a.position!.y - c.from.y
      next = next.map((n) => (c.start.has(n.id) ? { ...n, position: { x: c.start.get(n.id)!.x + dx, y: c.start.get(n.id)!.y + dy } } : n))
    }
    live.current = next
    setNodes(next)
    if (changes.some((x) => x.type === 'select')) {
      const sel = next.filter((n) => n.selected), qs = quests(sel)
      useStore.setState({ selected: qs[qs.length - 1] ?? null, multi: qs.length > 1 ? qs : [] })
      // Areas and notes picked by a click on the canvas (see onPaneClick) are kept unless React Flow itself unselects them.
      const off = new Set(changes.flatMap((x) => (x.type === 'select' && !x.selected ? [x.id] : [])))
      useUi.setState({ picked: [...new Set([...U().picked.filter((id) => !off.has(id)), ...sel.filter((n) => n.type !== 'quest').map((n) => n.id)])] })
    }
  }, [keys.alt, flow])
  const tray = useRef<HTMLDivElement>(null)
  const overTray = (e: MouseEvent | TouchEvent) => { const r = tray.current?.getBoundingClientRect(), y = 'clientY' in e ? e.clientY : e.changedTouches[0].clientY; return !!r && y >= r.top }
  const dragStart = (_: unknown, node: Node, dragged: Node[]) => {
    const areas = dragged.filter((n) => n.type === 'frame').map((n) => areaOf(n.id)).filter(Boolean) as MapFrame[]
    if (!areas.length) return
    const moving = new Set(dragged.map((n) => n.id)), m = S().map
    const start = new Map(areas.flatMap((f) => inside(m, f)).filter((id) => !moving.has(id)).flatMap((id) => { const n = live.current.find((x) => x.id === id); return n ? [[id, n.position] as const] : [] }))
    carry.current = { anchor: node.id, from: node.position, start }
  }
  const dragStop = (e: MouseEvent | TouchEvent, _: Node, dragged: Node[]) => {
    setGuides(null)
    const ids = new Set(dragged.map((n) => n.id)), moved = live.current.filter((n) => ids.has(n.id) || carry.current?.start.has(n.id))
    carry.current = null
    if (overTray(e) && quests(dragged).length) { unplace(quests(dragged)); return done(`Moved ${quests(dragged).length > 1 ? plural(quests(dragged).length, 'quest') : label(pages, dragged[0].id)} to Hooks`) }
    const cards = Object.fromEntries(moved.filter((n) => n.type === 'quest').map((n) => [n.id, n.position]))
    const items = Object.fromEntries(moved.filter((n) => n.type !== 'quest').map((n) => [n.id, n.position]))
    const name = moved.length === 1 ? (moved[0].type === 'quest' ? label(pages, moved[0].id) : moved[0].type === 'frame' ? (moved[0].data as Area).label || 'an area' : 'a note') : plural(moved.length, 'item')
    writeMap(moveItems(place(S().map, cards), items), `Move ${name}`)
  }

  const fit = useCallback((ids?: string[]) => flow.fitView({ padding: 0.12, duration: 300, maxZoom: 1.2, ...(ids?.length ? { nodes: ids.map((id) => ({ id })) } : {}) }), [flow])
  const viewKey = `qn.view:${project?.root}`
  const restore = () => { try { const v = JSON.parse(localStorage.getItem(viewKey) ?? 'null'); if (v) { flow.setViewport(v); return remember() } } catch { /* fit instead */ } flow.fitView({ padding: 0.12, maxZoom: 1.1 }); remember() }
  const remember = () => {
    try { localStorage.setItem(viewKey, JSON.stringify(flow.getViewport())) } catch { /* not kept */ }
    const r = document.querySelector('.map .react-flow')?.getBoundingClientRect()
    if (r) { const c = flow.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); setMiddle({ x: c.x - CARD_W / 2, y: c.y - CARD_H / 2 }) }
  }

  const unlink = useCallback((e: Edge<QuestLink>) => {
    const l = e.data!, name = `${label(pages, l.from)} → ${label(pages, l.to)}`
    if (l.kind === 'leads') update(l.from, (p) => ({ ...p, data: { ...p.data, leads_to: (p.data.leads_to ?? []).filter((r: Row) => r.ref !== l.to) } }), `Remove the link ${name}`)
    else update(l.from, (p) => ({ ...p, body: removePayoff(p.body, l.line!, l.to) }), `Remove the payoff ${name}`)
    setEdgeSel(null)
    done(`Removed the link ${name}`)
  }, [pages])
  const reconnect = (old: Edge<QuestLink>, c: Connection) => {
    const l = old.data!
    if (!c.source || !c.target || (c.source === l.from && c.target === l.to)) return
    if (l.kind === 'payoff') {
      if (c.source !== l.from) return toast('A payoff belongs to a branch row of its quest; move its arrow end instead.')
      return update(l.from, (p) => ({ ...p, body: addPayoff(removePayoff(p.body, l.line!, l.to), l.line!, c.target) }), `Move the payoff “${l.condition}”`)
    }
    batch(`Relink ${label(pages, l.from)}`, () => {
      update(l.from, (p) => ({ ...p, data: { ...p.data, leads_to: (p.data.leads_to ?? []).filter((r: Row) => r.ref !== l.to) } }))
      update(c.source, (p) => ({ ...p, data: { ...p.data, leads_to: [...(p.data.leads_to ?? []).filter((r: Row) => r.ref !== c.target), { ref: c.target }] } }))
    })
  }
  const connect = (c: { source: string; target: string }, kind: 'leads' | number) => {
    const name = `${label(pages, c.source)} → ${label(pages, c.target)}`
    if (kind === 'leads') update(c.source, (p) => ({ ...p, data: { ...p.data, leads_to: [...(p.data.leads_to ?? []).filter((r: Row) => r.ref !== c.target), { ref: c.target }] } }), `Link ${name}`)
    else update(c.source, (p) => ({ ...p, body: addPayoff(p.body, kind, c.target) }), `Add the payoff ${name}`)
    setMenu(null)
  }
  const flowAt = (x: number, y: number) => flow.screenToFlowPosition({ x, y })
  const pointAt = (x: number, y: number) => { const p = flowAt(x, y); return { x: p.x - CARD_W / 2, y: p.y - CARD_H / 2 } }
  const onConnectEnd = async (e: MouseEvent | TouchEvent, s: FinalConnectionState) => {
    if (s.isValid || !s.fromNode) return
    const pt = 'clientX' in e ? e : e.changedTouches[0], from = s.fromNode.id
    const id = await batch(`Add a quest after ${label(pages, from)}`, async () => {
      const id = await createQuest({ status: 'idea' }, pointAt(pt.clientX, pt.clientY))
      update(from, (p) => ({ ...p, data: { ...p.data, leads_to: [...(p.data.leads_to ?? []), { ref: id }] } }))
      return id
    })
    peek(id)
  }
  const createAt = async (x: number, y: number) => peek(await createQuest({ status: 'idea' }, pointAt(x, y)))

  useEffect(() => {
    const onFit = (e: Event) => fit((e as CustomEvent).detail === 'selection' ? [...targets(), ...U().picked] : undefined)
    const onFocus = (e: Event) => {
      const { id, keep } = (e as CustomEvent).detail as { id: string; keep?: boolean }, n = at.get(id)
      if (n) flow.setCenter(n.x + CARD_W / 2, n.y + CARD_H / 2, { zoom: keep ? flow.getZoom() : Math.max(flow.getZoom(), 1), duration: 300 })
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Alt' || e.key === 'Shift') setKeys({ alt: e.altKey, shift: e.shiftKey })
      const s = S(), ui = U(), mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase()
      if (e.type !== 'keydown' || s.dialog || s.palette || s.menu || (e.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"], .peek')) return
      if (e.key === 'Escape') { useUi.setState({ picked: [], tool: null }); setEdgeSel(null); return }
      if ((e.key === 'Delete' || e.key === 'Backspace') && !mod) {
        if (ui.picked.length) { e.preventDefault(); removeItems(ui.picked) }
        const edge = edges.find((x) => x.id === edgeSel)
        if (edge) { e.preventDefault(); unlink(edge) }
        return
      }
      if (mod && k === 'a') { e.preventDefault(); const qs = [...at.keys()]; useStore.setState({ multi: qs.length > 1 ? qs : [], selected: qs[0] ?? null }); useUi.setState({ picked: (s.map.notes ?? []).map((n) => n.id) }); return }
      if (mod && k === 'c') { const c = chosen(); if (c.quests.length + c.frames.length + c.notes.length) { clip = c; toast(`Copied ${plural(c.quests.length + c.frames.length + c.notes.length, 'item')}`, undefined, 'clip') } return }
      if (mod && k === 'v' && clip) { e.preventDefault(); paste(clip, pointer.current ? flowAt(pointer.current.x, pointer.current.y) : undefined); return }
      if (e.key.startsWith('Arrow') && !mod && !e.altKey) {
        const [dx, dy] = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, number[]>)[e.key]
        if (ui.picked.length) { // areas and notes nudge here; cards are nudged by the app's own keys
          const items = Object.fromEntries([...(s.map.frames ?? []), ...(s.map.notes ?? [])].filter((i) => ui.picked.includes(i.id)).map((i) => [i.id, { x: i.x + dx * (e.shiftKey ? 20 : 5), y: i.y + dy * (e.shiftKey ? 20 : 5) }]))
          writeMap(moveItems(s.map, items), 'Nudge', 'nudge')
        } else if (!targets().length) { const v = flow.getViewport(); flow.setViewport({ ...v, x: v.x - dx * (e.shiftKey ? 240 : 80), y: v.y - dy * (e.shiftKey ? 240 : 80) }, { duration: 120 }) }
      }
    }
    const frame = () => areaAround([...targets(), ...U().picked.filter((id) => id.startsWith('n_'))])
    const tidyNow = () => tidy(targets())
    const pickTool = (e: Event) => useUi.setState({ tool: (e as CustomEvent).detail })
    const ups = [['qn:fit', onFit], ['qn:focus', onFocus], ['qn:frame', frame], ['qn:tidy', tidyNow], ['qn:duplicate', duplicateSel], ['qn:tool', pickTool], ['keydown', key], ['keyup', key]] as const
    for (const [n, f] of ups) window.addEventListener(n, f as EventListener)
    return () => { for (const [n, f] of ups) window.removeEventListener(n, f as EventListener) }
  }, [flow, at, fit, edges, edgeSel, unlink])

  const linkMenu = (e: Edge<QuestLink>): MenuItem[] => [
    { label: `Open ${label(pages, e.source)}`, run: () => peek(e.source) }, { label: `Open ${label(pages, e.target)}`, run: () => peek(e.target) },
    '-', { label: e.data!.kind === 'leads' ? 'Remove this link' : `Remove the payoff “${e.data!.condition}”`, key: 'Del', danger: true, run: () => unlink(e) },
  ]
  const paneMenu = (e: React.MouseEvent | MouseEvent): MenuItem[] => {
    const p = flowAt(e.clientX, e.clientY), area = areaAt(p)
    if (area) useUi.setState({ picked: [area] })
    return [
      { label: 'New quest here', run: () => createAt(e.clientX, e.clientY) },
      { label: 'Add a note here', key: 'T', run: () => addNote(p) }, ...(area ? [] : [{ label: 'Add an area here', key: 'A', run: () => addArea({ x: p.x, y: p.y, w: 480, h: 320 }) }]),
      ...(clip ? [{ label: 'Paste here', key: 'Ctrl V', run: () => paste(clip!, p) }] : []),
      ...(area ? ['-' as const, ...areaMenu(area)] : []),
      '-',
      { label: payoffs ? 'Hide payoff links' : 'Show payoff links', key: 'P', run: () => useStore.setState({ payoffs: !payoffs }) },
      { label: 'Fit everything', key: 'Shift 1', run: () => fit() }, { label: 'Snap to grid', on: snap, run: () => toggleSnap() },
      '-', { label: 'Export as JSON Canvas…', run: exportCanvas }, { label: 'Import a JSON Canvas layout…', run: importCanvas },
    ]
  }
  const toggleSnap = () => { setSnap(!snap); try { localStorage.setItem('qn.snap', snap ? 'off' : 'on') } catch { /* not kept */ } }
  const nodeMenu = (e: React.MouseEvent, n: Node) => {
    if (n.type === 'quest') { if (!S().multi.includes(n.id)) useStore.setState({ selected: n.id, multi: [] }); return openMenu(e, cardMenu(n.id)) }
    useUi.setState({ picked: U().picked.includes(n.id) ? U().picked : [n.id] })
    if (n.type === 'frame') return openMenu(e, areaMenu(n.id))
    openMenu(e, [{ label: 'Edit', run: () => useUi.setState({ editing: n.id }) }, { label: 'Duplicate', key: 'Ctrl D', run: duplicateSel },
      '-', { label: 'Delete the note', key: 'Del', danger: true, run: () => removeItems([n.id]) }])
  }

  const placed = at.size, shown = [...at.values()].filter((n) => matches(pages[n.id].data)).length
  return (
    <div className={`map${keys.shift ? ' shift' : ''}`} onDragOver={(e) => e.preventDefault()} onMouseMove={(e) => { pointer.current = { x: e.clientX, y: e.clientY } }}
      onDrop={(e) => { const id = e.dataTransfer.getData('qn/quest'); if (id) { placeCards({ [id]: pointAt(e.clientX, e.clientY) }, `Place ${label(pages, id)}`); done(`Placed ${label(pages, id)}`) } }}
      onDoubleClick={(e) => (e.target as HTMLElement).classList.contains('react-flow__pane') && createAt(e.clientX, e.clientY)}>
      <FilterBar shown={shown} total={placed} snap={snap} toggleSnap={toggleSnap} fit={fit} />
      <div className="flow"><ReactFlow<Node, Edge<QuestLink>> nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} minZoom={0.15} maxZoom={2} onInit={restore} onMoveEnd={remember}
        selectionOnDrag panOnDrag={[1, 2]} panOnScroll selectionMode={SelectionMode.Full} multiSelectionKeyCode={['Control', 'Meta', 'Shift']}
        snapToGrid={snap && !keys.alt} snapGrid={[20, 20]} elevateNodesOnSelect={false} onlyRenderVisibleElements={nodes.length > 300}
        zoomOnDoubleClick={false} disableKeyboardA11y deleteKeyCode={null} proOptions={{ hideAttribution: true }}
        onNodeDragStart={dragStart} onNodeDragStop={dragStop}
        onNodeClick={() => setEdgeSel(null)}
        onNodeDoubleClick={(e, n) => (n.type === 'quest' ? openFull(n.id) : n.type === 'frame' && createAt(e.clientX, e.clientY))}
        onNodeMouseEnter={(_, n) => n.type === 'quest' && setHover(n.id)} onNodeMouseLeave={() => setHover(null)}
        onPaneClick={(e) => { setMenu(null); setEdgeSel(null); const a = areaAt(flowAt(e.clientX, e.clientY)); useUi.setState({ picked: a ? [a] : [] }) }}
        onNodeContextMenu={nodeMenu}
        onEdgeClick={(_, e) => { useStore.setState({ selected: null, multi: [] }); setEdgeSel(e.id) }}
        onEdgeContextMenu={(ev, e) => { setEdgeSel(e.id); openMenu(ev, linkMenu(e)) }}
        onPaneContextMenu={(e) => openMenu(e, paneMenu(e))}
        edgesReconnectable onReconnect={reconnect}
        onConnect={(c) => { const r = window.event as MouseEvent | undefined; setMenu({ ...c, x: r?.clientX ?? 200, y: r?.clientY ?? 200 }) }}
        onConnectEnd={onConnectEnd}>
        {guides && <ViewportPortal>
          {guides.x !== undefined && <div className="guide v" style={{ transform: `translate(${guides.x}px, -50000px)` }} />}
          {guides.y !== undefined && <div className="guide h" style={{ transform: `translate(-50000px, ${guides.y}px)` }} />}
        </ViewportPortal>}
        {tool && <DrawLayer tool={tool} snap={snap && !keys.alt} />}
        <Controls position="bottom-left" showInteractive={false} />
        <MiniMap pannable zoomable nodeStrokeWidth={3} nodeColor={(n) => (n.type === 'frame' ? COLORS[((n.data as Area).color - 1) % 6][1] : n.type === 'note' ? NOTE_FILL : (n.data as Card).needs ? '#d9a441' : '#c9bfa9')} />
      </ReactFlow></div>
      {!placed && !map.frames?.length && !map.notes?.length && <div className="map-hint">Double-click anywhere to add a quest, press A to draw an area, or drag a quest in from Hooks.</div>}
      {menu && <div className="menu" style={{ left: menu.x, top: menu.y }}>
        <button onClick={() => connect(menu, 'leads')}>Leads to {label(pages, menu.target)}</button>
        {branches(pages[menu.source].body, schema.branches).filter((b) => b.condition).map((b) => <button key={b.line} onClick={() => connect(menu, b.line)}>Pays off: {b.condition}</button>)}
        <button className="muted" onClick={() => setMenu(null)}>Cancel</button></div>}
      <Tray at={at} cut={cut} matches={matches} refEl={tray} />
    </div>
  )
}

/** The drawing tools: drag out an area (a click makes a standard one), or click where a note goes. Escape puts the tool down. */
function DrawLayer({ tool, snap }: { tool: 'area' | 'note'; snap: boolean }) {
  const flow = useReactFlow()
  const ref = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const g = (v: number) => (snap ? Math.round(v / 20) * 20 : Math.round(v))
  const finish = (e: React.MouseEvent) => {
    const start = drag ?? { x0: e.clientX, y0: e.clientY }
    setDrag(null)
    useUi.setState({ tool: null })
    const [a, b] = [flow.screenToFlowPosition({ x: start.x0, y: start.y0 }), flow.screenToFlowPosition({ x: e.clientX, y: e.clientY })]
    if (tool === 'note') return addNote({ x: g(b.x), y: g(b.y) })
    const tiny = Math.abs(e.clientX - start.x0) < 24 && Math.abs(e.clientY - start.y0) < 24
    addArea(tiny ? { x: g(b.x), y: g(b.y), w: 480, h: 320 } : { x: g(Math.min(a.x, b.x)), y: g(Math.min(a.y, b.y)), w: g(Math.abs(b.x - a.x)), h: g(Math.abs(b.y - a.y)) })
  }
  const r = ref.current?.getBoundingClientRect()
  return (
    <div className="draw-layer" ref={ref} title={tool === 'area' ? 'Drag to draw an area; Esc to stop' : 'Click where the note goes; Esc to stop'}
      onMouseDown={(e) => e.button === 0 && setDrag({ x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY })}
      onMouseMove={(e) => drag && setDrag({ ...drag, x1: e.clientX, y1: e.clientY })} onMouseUp={(e) => e.button === 0 && finish(e)}
      onContextMenu={(e) => { e.preventDefault(); useUi.setState({ tool: null }) }}>
      {drag && r && tool === 'area' && <div className="draw-rect" style={{ left: Math.min(drag.x0, drag.x1) - r.left, top: Math.min(drag.y0, drag.y1) - r.top, width: Math.abs(drag.x1 - drag.x0), height: Math.abs(drag.y1 - drag.y0) }} />}
    </div>
  )
}

/** Quests not on the map yet. One line normally; "Show all" opens it over the map. The map's filter dims hooks too. */
function Tray({ at, cut, matches, refEl }: { at: Map<string, unknown>; cut: boolean; matches: (q: Data) => boolean; refEl: React.RefObject<HTMLDivElement | null> }) {
  const { pages, selected, multi } = useStore()
  const [open, setOpen] = useState(false)
  const hooks = byType(pages, 'quest').map((p) => p.data).filter((q) => !at.has(q.id) && (cut || q.status !== 'cut'))
  return (
    <div className={`tray${open ? ' open' : ''}`} ref={refEl}>
      <b>Hooks{hooks.length ? ` (${hooks.length})` : ''}</b>
      {hooks.map((q) => <span key={q.id} className={`hook${selected === q.id || multi.includes(q.id) ? ' sel' : ''}${matches(q) ? '' : ' dim'}`} draggable onDragStart={(e) => e.dataTransfer.setData('qn/quest', q.id)}
        onClick={(e) => (e.ctrlKey || e.metaKey || e.shiftKey ? pick(q.id) : peek(q.id))} onContextMenu={(e) => { if (!multi.includes(q.id)) useStore.setState({ selected: q.id, multi: [] }); openMenu(e, pageMenu(q.id)) }}>{label(pages, q.id)}</span>)}
      {!hooks.length && <span className="muted">Quests not on the map wait here. Drag a card here to take it off the map, or a hook onto the map to place it.</span>}
      <span className="tray-actions">{hooks.length > 0 && <button onClick={placeAll} title="Lay out every hook to the right of the map">Place all</button>}
        {hooks.length > 4 && <button onClick={() => setOpen(!open)}>{open ? 'Show less' : 'Show all'}</button>}</span>
    </div>
  )
}

function matchQuest(s: Schema, pages: Record<string, { body: string }>, q: Data, filters: string[], text: string, engine: EngineIndex | null) {
  const refs = refsOf(s, { file: '', data: q, body: pages[q.id]?.body ?? '' })
  const t = text.toLowerCase().trim()
  return filters.every((f) => f.startsWith('status:') ? q.status === f.slice(7) : f.startsWith('engine:') ? questState(q, engine) === f.slice(7) : refs.includes(f) || q.act === f)
    && (!t || `${q.code ?? ''} ${q.title} ${q.synopsis ?? ''}`.toLowerCase().includes(t))
}

function FilterBar({ shown, total, snap, toggleSnap, fit }: { shown: number; total: number; snap: boolean; toggleSnap: () => void; fit: (ids?: string[]) => void }) {
  const { filters, text, payoffs, pages, schema, map, multi } = useStore()
  const tool = useUi((s) => s.tool)
  const hold = (t: 'area' | 'note') => useUi.setState({ tool: tool === t ? null : t })
  return (
    <div className="filterbar">
      <button className={tool === 'area' ? 'on' : ''} onClick={() => hold('area')} title="Draw an area (A)">+ Area</button>
      <button className={tool === 'note' ? 'on' : ''} onClick={() => hold('note')} title="Add a note (T)">+ Note</button>
      {filters.map((f) => <span key={f} className="chip on" title="Remove this filter" onClick={() => toggleFilter(f, true)}>{f.includes(':') ? f.replace(':', ': ') : label(pages, f)} ×</span>)}
      <input id="map-filter" value={text} placeholder="Filter the map (F)" onChange={(e) => useStore.setState({ text: e.target.value })} onKeyDown={(e) => e.key === 'Escape' && (e.currentTarget.blur(), useStore.setState({ text: '' }))} />
      <select value="" onChange={(e) => e.target.value && toggleFilter(e.target.value, true)}>
        <option value="">+ Filter</option>
        <optgroup label="Status">{STATUSES.map((s) => <option key={s} value={`status:${s}`}>{STATUS_LABEL[s]}{s === 'cut' ? ' (shows cut quests)' : ''}</option>)}</optgroup>
        {schema.engine && <optgroup label="Engine"><option value="engine:needs">{stateLabel('needs', schema.engine.name)}</option><option value="engine:none">Not in engine</option></optgroup>}
        {['act', ...schema.kinds.map((k) => k.id).filter((k) => !['quest', 'questline', 'act'].includes(k))].map((k) => <optgroup key={k} label={schema.kinds.find((x) => x.id === k)?.plural ?? k}>
          {byType(pages, k).map((p) => <option key={p.data.id} value={p.data.id}>{label(pages, p.data.id)}</option>)}</optgroup>)}
      </select>
      {(filters.length > 0 || text) && <button onClick={() => useStore.setState({ filters: [], text: '' })}>Clear</button>}
      {(map.frames?.length ?? 0) > 0 && <select value="" title="Go to an area" onChange={(e) => e.target.value && fit([e.target.value])}>
        <option value="">Go to area…</option>{map.frames!.map((f) => <option key={f.id} value={f.id}>{f.label || 'Area'}</option>)}</select>}
      <span className="count">{shown === total ? `${total} quests` : `${shown} of ${total} quests`}</span>
      <button className={snap ? 'on' : ''} onClick={toggleSnap} title="Snap to a 20 px grid; hold Alt to drag freely">Snap</button>
      <button className={payoffs ? 'on' : ''} onClick={() => useStore.setState({ payoffs: !payoffs })} title="P">Payoffs</button>
      <button onClick={() => fit()} title="Shift 1">Fit</button>
      <button disabled={multi.length < 2} onClick={() => tidy(targets())} title="Lay out the selected cards left to right, keeping their rough order">Tidy</button>
    </div>
  )
}
