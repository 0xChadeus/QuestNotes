// The master map: Acts and their sub-sections are columns, questlines are lanes, and a card's cell is its data.
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ReactFlow, Handle, Position, MiniMap, ViewportPortal, MarkerType, useNodesState, useReactFlow, useStore as useFlow, useViewport,
  type Node, type Edge, type NodeProps, type FinalConnectionState,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useStore, setData, update, peek, openFull, createPage, writeMap, toast, toggleFilter } from './store'
import { byType, label, roman, type Pages } from './derive'
import { addPayoff, branches, refsOf, type Data } from '../../shared/page'
import { questState, type EngineIndex } from '../../shared/engine'
import type { MapView as MapData } from '../../shared/api'
import type { Row } from '../../shared/schema'

const CW = 270, CARD_W = 230, CARD_H = 116, GAP = 14, PAD = 18, BAND_H = CARD_H + PAD * 2
interface Col { act: string; sub: string; label: string; actLabel: string; first: boolean }
interface Lane { id: string; label: string; y: number; h: number }

function layout(pages: Pages, map: MapData) {
  const cols: Col[] = byType(pages, 'act').flatMap((a) => {
    const subs: string[] = a.data.subsections?.filter(Boolean).length ? a.data.subsections.filter(Boolean) : ['']
    return subs.map((sub, i) => ({ act: a.data.id, sub, label: sub, actLabel: `Act ${roman(a.data.order ?? 0)} · ${a.data.title}`, first: i === 0 }))
  })
  const lines = byType(pages, 'questline')
  const emergent = new Set(lines.filter((l) => l.data.kind === 'emergent').map((l) => l.data.id))
  const lanes: Lane[] = [...lines.filter((l) => !emergent.has(l.data.id)).map((l) => ({ id: l.data.id, label: l.data.title, y: 0, h: 0 })), { id: '', label: 'No questline', y: 0, h: 0 }]
  const cells = new Map<string, Data[]>()
  const band: Data[] = [], tray: Data[] = []
  for (const q of byType(pages, 'quest').map((p) => p.data).filter((d) => d.status !== 'cut')) {
    if (emergent.has(q.questline)) { band.push(q); continue }
    const inAct = cols.filter((c) => c.act === q.act)
    if (!inAct.length) { tray.push(q); continue }
    const col = inAct.find((c) => c.sub === (q.subsection ?? '')) ?? inAct[0]
    const lane = lanes.find((l) => l.id === (q.questline ?? '')) ?? lanes[lanes.length - 1]
    const key = `${col.act}|${col.sub}|${lane.id}`
    cells.set(key, [...(cells.get(key) ?? []), q])
  }
  for (const [key, list] of cells) {
    const order = map.cells?.[key] ?? []
    list.sort((a, b) => ((order.indexOf(a.id) + 1 || 1e6) - (order.indexOf(b.id) + 1 || 1e6)) || `${a.code ?? ''}${a.title}`.localeCompare(`${b.code ?? ''}${b.title}`))
  }
  const used = lanes.filter((l) => l.id || cols.some((c) => cells.has(`${c.act}|${c.sub}|`)))
  let y = 0
  for (const l of used) {
    const n = Math.max(1, ...cols.map((c) => cells.get(`${c.act}|${c.sub}|${l.id}`)?.length ?? 0))
    Object.assign(l, { y, h: PAD * 2 + n * (CARD_H + GAP) - GAP })
    y += l.h
  }
  const place: Record<string, { x: number; y: number }> = {}
  cols.forEach((c, ci) => used.forEach((l) => (cells.get(`${c.act}|${c.sub}|${l.id}`) ?? []).forEach((q, k) => { place[q.id] = { x: ci * CW + (CW - CARD_W) / 2, y: l.y + PAD + k * (CARD_H + GAP) } })))
  band.forEach((q, k) => { place[q.id] = { x: k * (CARD_W + GAP) + (CW - CARD_W) / 2, y: y + PAD } })
  return { cols, lanes: used, cells, band, tray, place, bandY: y, emergentLine: [...emergent][0] }
}
type Layout = ReturnType<typeof layout>

/** The cell under a point of the canvas, as the quest fields it implies. */
function cellAt(L: Layout, x: number, y: number) {
  const col = L.cols[Math.max(0, Math.min(L.cols.length - 1, Math.floor(x / CW)))]
  if (!col) return null
  if (L.emergentLine && y >= L.bandY) return { act: undefined, subsection: undefined, questline: L.emergentLine, key: '' }
  const lane = L.lanes.find((l) => y >= l.y && y < l.y + l.h) ?? L.lanes[L.lanes.length - 1]
  return { act: col.act, subsection: col.sub || undefined, questline: lane.id || undefined, key: `${col.act}|${col.sub}|${lane.id}` }
}

const TONE: Record<string, string> = { idea: '#b9b2a4', outline: '#8fa8b8', draft: '#c4a35a', review: '#8a6fb0', ready: '#4f8a4a', cut: '#999' }

function QuestCard({ data }: NodeProps<Node<{ id: string; dim: boolean }>>) {
  const { pages, engine, selected } = useStore()
  const zoom = useFlow((s) => s.transform[2])
  const q = pages[data.id]?.data
  if (!q) return null
  const level = zoom < 0.55 ? 'far' : zoom > 1.3 ? 'near' : 'mid'
  const state = questState(q, engine)
  const chips = [...(q.issuer ?? []), ...(q.renown ?? []), ...(q.thresholds ?? [])].filter((r: Row) => r.ref && pages[r.ref]).map((r: Row) => r.ref!)
  const synopsis = q.synopsis || /## Description\s*\n+([^\n#]+)/.exec(pages[data.id].body)?.[1]?.replace(/\[\[[^\]|]+\|?([^\]]*)\]\]/g, '$1') || ''
  return (
    <div className={`card z-${level}${data.dim ? ' dim' : ''}${selected === q.id ? ' sel' : ''}${state === 'needs' ? ' needs' : ''}`} style={{ borderTopColor: TONE[q.status ?? 'idea'] }} title={state === 'needs' ? 'Ready, and not yet in Animus' : undefined}>
      <Handle type="target" position={Position.Left} />
      {level === 'far' ? <div className="card-far" style={{ fontSize: Math.min(64, 15 / zoom) }}>{q.code || q.title}</div> : <div className="card-head"><b>{q.code}</b> {q.title}</div>}
      {level !== 'far' && <>
        <div className="card-syn">{synopsis}</div>
        <div className="card-chips">{chips.slice(0, level === 'near' ? 8 : 3).map((c) => <span key={c} className={`mini-chip t-${pages[c].data.type}`} onClick={(e) => { e.stopPropagation(); toggleFilter(c, e.shiftKey) }}>{pages[c].data.title}</span>)}{chips.length > 3 && level === 'mid' && <span className="more">+{chips.length - 3}</span>}</div>
        {level === 'near' && <ul className="card-branches">{branches(pages[data.id].body).filter((b) => b.condition).slice(0, 4).map((b) => <li key={b.line}>{b.condition}</li>)}</ul>}
      </>}
      <Handle type="source" position={Position.Right} />
    </div>
  )
}
const nodeTypes = { quest: QuestCard }

function Headers({ L }: { L: Layout }) {
  const { x, y, zoom } = useViewport()
  return <>
    <div className="col-heads">{L.cols.map((c, i) => <div key={i} style={{ left: x + i * CW * zoom, width: CW * zoom }} className={c.first ? 'first' : ''}>{c.first && <small>{c.actLabel}</small>}<span>{c.label || ' '}</span></div>)}</div>
    <div className="lane-heads">{L.lanes.map((l) => <div key={l.id} style={{ top: y + l.y * zoom, height: l.h * zoom }} onClick={() => l.id && peek(l.id)}><span>{l.label}</span></div>)}
      {L.emergentLine && <div style={{ top: y + L.bandY * zoom, height: BAND_H * zoom }} className="band"><span>Emergent</span></div>}</div>
  </>
}

export function MapView() {
  const { pages, map, engine, selected, filters, text, payoffs } = useStore()
  const flow = useReactFlow()
  const L = useMemo(() => layout(pages, map), [pages, map])
  const matches = useCallback((q: Data) => matchQuest(pages, q, filters, text, engine), [pages, filters, text, engine])
  const placed = useMemo(() => new Set(Object.keys(L.place)), [L])
  const laid: Node[] = useMemo(() => Object.entries(L.place).map(([id, position]) => ({ id, type: 'quest', position, data: { id, dim: !matches(pages[id].data) }, width: CARD_W, height: CARD_H })), [L, matches, pages])
  const [nodes, setNodes, onNodesChange] = useNodesState(laid)
  useEffect(() => setNodes(laid), [laid, setNodes])
  const edges: Edge[] = useMemo(() => {
    const out: Edge[] = []
    for (const id of placed) {
      const p = pages[id]
      for (const r of (p.data.leads_to ?? []) as Row[]) if (r.ref && placed.has(r.ref)) out.push({ id: `l-${id}-${r.ref}`, source: id, target: r.ref, className: 'leads', markerEnd: { type: MarkerType.ArrowClosed } })
      for (const b of branches(p.body)) for (const t of b.targets) if (placed.has(t)) {
        const on = payoffs || selected === id || selected === t
        out.push({ id: `p-${id}-${b.line}-${t}`, source: id, target: t, className: 'payoff', hidden: !on, label: selected === id || selected === t ? b.condition : undefined, markerEnd: { type: MarkerType.ArrowClosed } })
      }
    }
    return out
  }, [placed, pages, payoffs, selected])
  const [menu, setMenu] = useState<{ source: string; target: string; x: number; y: number } | null>(null)

  /** Fits the whole grid with its top-left corner under the headers, instead of centring it. */
  const fitTop = useCallback((duration = 0) => {
    const el = document.querySelector('.map .react-flow') as HTMLElement | null
    if (!el) return
    const w = Math.max(1, L.cols.length * CW), h = Math.max(1, L.bandY + (L.emergentLine ? BAND_H : 0))
    flow.setViewport({ x: 120, y: 48, zoom: Math.max(0.2, Math.min(1.1, (el.clientWidth - 140) / w, (el.clientHeight - 60) / h)) }, { duration })
  }, [flow, L])

  useEffect(() => {
    const fit = (e: Event) => {
      const act = (e as CustomEvent).detail as number | undefined
      if (!act) return fitTop(300)
      flow.fitView({ padding: 0.15, duration: 300, nodes: Object.keys(L.place).filter((id) => pages[pages[id].data.act]?.data.order === act).map((id) => ({ id })) })
    }
    /** Arrow keys move the selection to the nearest card in that direction. */
    const arrow = (e: Event) => {
      const [ax, ay] = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, number[]>)[(e as CustomEvent).detail]
      const from = L.place[useStore.getState().selected ?? '']
      if (!from) return
      let best = '', score = Infinity
      for (const [id, p] of Object.entries(L.place)) {
        const dx = p.x - from.x, dy = p.y - from.y, along = dx * ax + dy * ay, s = along + 2 * Math.abs(dx * ay - dy * ax)
        if (along > 0 && s < score) { best = id; score = s }
      }
      if (best) useStore.setState({ selected: best })
    }
    window.addEventListener('qn:fit', fit)
    window.addEventListener('qn:arrow', arrow)
    return () => { window.removeEventListener('qn:fit', fit); window.removeEventListener('qn:arrow', arrow) }
  }, [flow, L, pages, fitTop])

  const move = (id: string, x: number, y: number) => {
    const cell = cellAt(L, x + CARD_W / 2, y + CARD_H / 2)
    if (!cell) return
    const q = pages[id].data
    const before = { act: q.act, subsection: q.subsection, questline: q.questline }
    const oldMap = map
    const cells = { ...map.cells }
    for (const k of Object.keys(cells)) cells[k] = cells[k].filter((x) => x !== id)
    if (cell.key) {
      const others = (L.cells.get(cell.key) ?? []).filter((d) => d.id !== id)
      const at = others.filter((d) => (L.place[d.id]?.y ?? 0) < y).length
      cells[cell.key] = [...others.map((d) => d.id).slice(0, at), id, ...others.map((d) => d.id).slice(at)]
    }
    writeMap({ cells })
    const after = { act: cell.act, subsection: cell.subsection, questline: cell.questline }
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      setData(id, after)
      toast(`Moved ${label(pages, id)}`, { label: 'Undo', run: () => { setData(id, before); writeMap(oldMap) } })
    }
  }
  const onConnectEnd = async (e: MouseEvent | TouchEvent, s: FinalConnectionState) => {
    if (s.isValid || !s.fromNode) return
    const pt = 'clientX' in e ? e : e.changedTouches[0]
    const at = flow.screenToFlowPosition({ x: pt.clientX, y: pt.clientY })
    const cell = cellAt(L, at.x, at.y)
    if (!cell) return
    const from = s.fromNode.id
    const id = await createPage('quest', '', { status: 'draft', act: cell.act, subsection: cell.subsection, questline: cell.questline })
    update(from, (p) => ({ ...p, data: { ...p.data, leads_to: [...(p.data.leads_to ?? []), { ref: id }] } }))
    peek(id)
  }
  const connect = (c: { source: string; target: string }, kind: 'leads' | number) => {
    if (kind === 'leads') update(c.source, (p) => ({ ...p, data: { ...p.data, leads_to: [...(p.data.leads_to ?? []).filter((r: Row) => r.ref !== c.target), { ref: c.target }] } }))
    else update(c.source, (p) => ({ ...p, body: addPayoff(p.body, kind, c.target) }))
    setMenu(null)
  }
  const createAt = async (clientX: number, clientY: number) => {
    const at = flow.screenToFlowPosition({ x: clientX, y: clientY })
    const cell = cellAt(L, at.x, at.y)
    if (cell) peek(await createPage('quest', '', { status: 'draft', act: cell.act, subsection: cell.subsection, questline: cell.questline }))
  }
  if (!L.cols.length) return <div className="empty">The map needs at least one Act. <button onClick={async () => peek(await createPage('act', 'The first act', { order: 1, subsections: [] }, ''))}>Add an Act</button></div>
  const shown = Object.keys(L.place).filter((id) => matches(pages[id].data)).length
  return (
    <div className="map" onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { const id = e.dataTransfer.getData('qn/quest'); if (id) { const at = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY }); move(id, at.x - CARD_W / 2, at.y - CARD_H / 2) } }}
      onDoubleClick={(e) => (e.target as HTMLElement).classList.contains('react-flow__pane') && createAt(e.clientX, e.clientY)}>
      <FilterBar shown={shown} total={Object.keys(L.place).length} />
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} minZoom={0.2} maxZoom={2} onInit={() => fitTop()}
        zoomOnDoubleClick={false} disableKeyboardA11y deleteKeyCode={null} selectionKeyCode={null} multiSelectionKeyCode={null} proOptions={{ hideAttribution: true }}
        onNodeClick={(_, n) => useStore.setState({ selected: n.id })} onNodeDoubleClick={(_, n) => openFull(n.id)} onPaneClick={() => { useStore.setState({ selected: null }); setMenu(null) }}
        onNodeDragStop={(_, n) => move(n.id, n.position.x, n.position.y)}
        onConnect={(c) => { const r = (window.event as MouseEvent | undefined); setMenu({ ...c, x: r?.clientX ?? 200, y: r?.clientY ?? 200 }) }}
        onConnectEnd={onConnectEnd}>
        <ViewportPortal>
          {L.cols.map((c, i) => L.lanes.map((l) => <div key={`${i}-${l.id}`} className={`cell${pages[c.act]?.data.order % 2 ? ' odd' : ''}`} style={{ transform: `translate(${i * CW}px, ${l.y}px)`, width: CW, height: l.h }} />))}
          {L.emergentLine && <div className="cell band" style={{ transform: `translate(0px, ${L.bandY}px)`, width: Math.max(L.cols.length * CW, (L.band.length + 1) * (CARD_W + GAP)), height: BAND_H }} />}
        </ViewportPortal>
        <MiniMap pannable zoomable nodeStrokeWidth={3} nodeColor={(n) => (questState(pages[n.id]?.data, engine) === 'needs' ? '#d9a441' : '#c9bfa9')} />
      </ReactFlow>
      <Headers L={L} />
      {menu && <div className="menu" style={{ left: menu.x, top: menu.y }}>
        <button onClick={() => connect(menu, 'leads')}>Leads to {label(pages, menu.target)}</button>
        {branches(pages[menu.source].body).filter((b) => b.condition).map((b) => <button key={b.line} onClick={() => connect(menu, b.line)}>Pays off: {b.condition}</button>)}
        <button className="muted" onClick={() => setMenu(null)}>Cancel</button></div>}
      <div className="tray"><b>Hooks</b>{L.tray.map((q) => <span key={q.id} className="hook" draggable onDragStart={(e) => e.dataTransfer.setData('qn/quest', q.id)} onClick={() => peek(q.id)}>{label(pages, q.id)}</span>)}
        {!L.tray.length && <span className="muted">Quests without an Act wait here. Drag one onto the map to place it.</span>}</div>
    </div>
  )
}

function matchQuest(pages: Pages, q: Data, filters: string[], text: string, engine: EngineIndex | null) {
  const refs = refsOf({ file: '', data: q, body: pages[q.id]?.body ?? '' })
  const t = text.toLowerCase().trim()
  return filters.every((f) => f.startsWith('status:') ? q.status === f.slice(7) : f.startsWith('engine:') ? questState(q, engine) === f.slice(7) : refs.includes(f) || q.act === f)
    && (!t || `${q.code ?? ''} ${q.title} ${q.synopsis ?? ''}`.toLowerCase().includes(t))
}

function FilterBar({ shown, total }: { shown: number; total: number }) {
  const { filters, text, payoffs, pages, map } = useStore()
  const tidy = () => { writeMap({}); toast('Ordered every cell by quest code', { label: 'Undo', run: () => writeMap(map) }) }
  return (
    <div className="filterbar">
      {filters.map((f) => <span key={f} className="chip on" onClick={() => toggleFilter(f, true)}>{f.includes(':') ? f.replace(':', ': ') : label(pages, f)} ×</span>)}
      <input id="map-filter" value={text} placeholder="Filter the map (F)" onChange={(e) => useStore.setState({ text: e.target.value })} />
      <select value="" onChange={(e) => e.target.value && toggleFilter(e.target.value, true)}>
        <option value="">+ Filter</option>
        <optgroup label="Status">{['idea', 'outline', 'draft', 'review', 'ready'].map((s) => <option key={s} value={`status:${s}`}>{s}</option>)}</optgroup>
        <optgroup label="Engine"><option value="engine:needs">Needs creating in Animus</option><option value="engine:none">Not in engine</option></optgroup>
        {(['character', 'district', 'faction', 'threshold'] as const).map((t) => <optgroup key={t} label={t}>{byType(pages, t).map((p) => <option key={p.data.id} value={p.data.id}>{p.data.title}</option>)}</optgroup>)}
      </select>
      <span className="count">{shown === total ? `${total} quests` : `${shown} of ${total} quests`}</span>
      <button className={payoffs ? 'on' : ''} onClick={() => useStore.setState({ payoffs: !payoffs })} title="P">Payoffs</button>
      <button onClick={() => window.dispatchEvent(new Event('qn:fit'))} title="Z">Fit</button>
      <button onClick={tidy} title="Order every cell by quest code">Tidy</button>
    </div>
  )
}
