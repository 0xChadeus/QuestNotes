import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useStore, peek, toggleFilter, createPage, openFull, toast, showOnMap, setData, reorder, duplicate, trashPage, ask, type MenuItem } from './store'
import { call } from './api'
import { kindLabel, label } from './derive'
import { kindOf, STATUSES, STATUS_LABEL, type Schema, type Status } from '../../shared/schema'
import { STATE_TONE, type QuestState } from '../../shared/engine'

const Badge = ({ tone, children, title }: { tone: string; children: ReactNode; title?: string }) => <span className={`badge ${tone}`} title={title}>{children}</span>
export const StatusPill = ({ s }: { s?: Status }) => <span className={`status s-${s ?? 'idea'}`}>{STATUS_LABEL[s ?? 'idea']}</span>
export const EngineBadge = ({ state, text }: { state: QuestState | string; text: string }) => <Badge tone={STATE_TONE[state as QuestState] ?? 'grey'}>{text}</Badge>

/** A page reference: click opens it beside the current view, Alt-click filters the map by it. */
export function Chip({ id, onRemove }: { id: string; onRemove?: () => void }) {
  const { pages, schema } = useStore()
  const p = pages[id]
  return (
    <span className={`chip${p ? '' : ' missing'}`} style={kindStyle(schema, p?.data.type)} onClick={(e) => (e.altKey ? toggleFilter(id, e.shiftKey) : p && peek(id))} title={p ? `${kindLabel(schema, p.data.type)} · Alt-click to filter the map` : 'Missing page'}>
      {p ? label(pages, id) : `${id}?`}
      {onRemove && <button className="x" onClick={(e) => { e.stopPropagation(); onRemove() }}>×</button>}
    </span>
  )
}

/** A page kind's colour, for the edge of its chips. */
export const kindStyle = (s: Schema, type?: string) => ({ '--kc': (type && kindOf(s, type)?.color) || undefined }) as React.CSSProperties

/** Searches pages of the allowed types, recent ones first; can create a new page from the query. */
export function Picker({ types, onPick, onClose, extra = [] }: {
  types: string[]; onPick: (id: string) => void; onClose: () => void; extra?: { label: string; run: (q: string) => void }[]
}) {
  const [q, setQ] = useState('')
  const [i, setI] = useState(0)
  const { pages, recent, schema } = useStore()
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose() }
    setTimeout(() => document.addEventListener('mousedown', away))
    return () => document.removeEventListener('mousedown', away)
  }, [onClose])
  const items = useMemo(() => {
    const ql = q.toLowerCase()
    const hits = Object.values(pages).filter((p) => types.includes(p.data.type) && (!ql || `${p.data.code ?? ''} ${p.data.title} ${(p.data.aliases ?? []).join(' ')}`.toLowerCase().includes(ql)))
    hits.sort((a, b) => (recent.indexOf(b.data.id) + 1 || 0) - (recent.indexOf(a.data.id) + 1 || 0) || a.data.title.localeCompare(b.data.title))
    const list = hits.slice(0, 40).map((p) => ({ key: p.data.id, label: label(pages, p.data.id), kind: kindLabel(schema, p.data.type), run: () => onPick(p.data.id) }))
    if (q.trim() && types[0]) list.push({ key: '+new', label: `New ${kindLabel(schema, types[0]).toLowerCase()} “${q.trim()}”`, kind: '', run: async () => onPick(await createPage(types[0], q.trim())) })
    return [...list, ...extra.map((x) => ({ key: x.label, label: x.label, kind: '', run: () => x.run(q) }))]
  }, [q, pages, types, recent, extra, onPick, schema])
  const pick = (n: number) => { items[n]?.run(); onClose() }
  return (
    <div className="picker" ref={ref}>
      <input autoFocus value={q} placeholder="Search…" onChange={(e) => { setQ(e.target.value); setI(0) }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { setI(Math.min(i + 1, items.length - 1)); e.preventDefault() }
          if (e.key === 'ArrowUp') { setI(Math.max(i - 1, 0)); e.preventDefault() }
          if (e.key === 'Enter') pick(i)
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() }
        }} />
      <ul>{items.map((it, n) => <li key={it.key} className={n === i ? 'on' : ''} onMouseDown={() => pick(n)}>{it.label}<small>{it.kind}</small></li>)}</ul>
    </div>
  )
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts)
  return <div className="toasts">{toasts.map((t) => <div key={t.id} className="toast">{t.text}{t.action && <button onClick={() => { t.action!.run(); useStore.setState({ toasts: useStore.getState().toasts.filter((x) => x !== t) }) }}>{t.action.label}</button>}</div>)}</div>
}

export const copy = (text: string) => navigator.clipboard.writeText(text).then(() => toast('Copied'), () => toast('Could not copy'))
export const Copy = ({ text }: { text: string }) => <button className="mini" onClick={() => copy(text)}>Copy</button>

type Pointer = { clientX: number; clientY: number; preventDefault(): void; stopPropagation(): void }
/** Opens a context menu at the pointer instead of the browser's own. */
export function openMenu(e: Pointer, items: MenuItem[]) {
  e.preventDefault(); e.stopPropagation()
  if (items.length) useStore.setState({ menu: { x: e.clientX, y: e.clientY, items } })
}

export function rename(id: string) {
  const p = useStore.getState().pages[id]
  if (p) ask({ title: `Rename ${kindLabel(useStore.getState().schema, p.data.type).toLowerCase()}`, value: p.data.title, ok: 'Rename', run: (v) => setData(id, { title: v }, `Rename ${p.data.title || 'page'}`) })
}

/** Everything one can do to a page, for its context menus. */
export function pageMenu(id: string): MenuItem[] {
  const p = useStore.getState().pages[id]
  if (!p) return []
  const quest = p.data.type === 'quest', title = p.data.title || 'Untitled'
  return [
    { label: 'Open beside', key: 'Space', run: () => peek(id) },
    { label: 'Open full', key: 'Enter', run: () => openFull(id) },
    ...(quest ? [{ label: 'Show on map', run: () => showOnMap(id) }, { label: 'Handoff brief', run: () => peek(id, true) }] : []),
    '-',
    ...(quest ? [...STATUSES.map((st, i): MenuItem => ({ label: STATUS_LABEL[st], key: i < 5 ? String(i + 1) : undefined, on: (p.data.status ?? 'idea') === st, run: () => setData(id, { status: st }, `Set ${title} to ${STATUS_LABEL[st]}`) })), '-' as const] : []),
    ...(typeof p.data.order === 'number' ? [{ label: 'Move earlier', run: () => reorder(id, -1) }, { label: 'Move later', run: () => reorder(id, 1) }, '-' as const] : []),
    { label: 'Rename…', key: 'F2', run: () => rename(id) },
    { label: 'Duplicate', key: 'Ctrl D', run: () => duplicate(id) },
    { label: 'Copy link', run: () => copy(`[[${id}]]`) },
    { label: 'Open in another editor', run: () => call('shell:open', p.file) },
    '-',
    { label: 'Move to Trash', key: 'Del', danger: true, run: () => trashPage(id) },
  ]
}

export function ContextMenu() {
  const menu = useStore((s) => s.menu)
  const [i, setI] = useState(-1)
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: 0, top: 0 })
  useEffect(() => {
    if (!menu) return
    setI(-1)
    const r = ref.current!.getBoundingClientRect()
    setPos({ left: Math.min(menu.x, innerWidth - r.width - 6), top: Math.min(menu.y, innerHeight - r.height - 6) })
    const close = () => useStore.setState({ menu: undefined })
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) close() }
    document.addEventListener('mousedown', away); window.addEventListener('blur', close); window.addEventListener('resize', close); document.addEventListener('wheel', close)
    return () => { document.removeEventListener('mousedown', away); window.removeEventListener('blur', close); window.removeEventListener('resize', close); document.removeEventListener('wheel', close) }
  }, [menu])
  useEffect(() => { if (menu) ref.current?.focus() }, [menu])
  if (!menu) return null
  const items = menu.items.filter((x, n, a) => x !== '-' || (n > 0 && n < a.length - 1 && a[n - 1] !== '-'))
  const acts = items.filter((x) => x !== '-') as Exclude<MenuItem, '-'>[]
  const run = (x: Exclude<MenuItem, '-'>) => { useStore.setState({ menu: undefined }); x.run() }
  return (
    <div className="menu ctx" ref={ref} style={pos} tabIndex={-1} role="menu" onKeyDown={(e) => {
      e.stopPropagation()
      if (e.key === 'ArrowDown') setI((i + 1) % acts.length)
      else if (e.key === 'ArrowUp') setI((i - 1 + acts.length) % acts.length)
      else if (e.key === 'Enter' && acts[i]) run(acts[i])
      else if (e.key === 'Escape') useStore.setState({ menu: undefined })
      else return
      e.preventDefault()
    }}>
      {items.map((x, n) => x === '-' ? <hr key={n} /> :
        <button key={n} role="menuitem" className={`${x.danger ? 'danger' : ''}${acts.indexOf(x) === i ? ' hot' : ''}`} onMouseEnter={() => setI(acts.indexOf(x))} onClick={() => run(x)}>
          <span className="check">{x.on ? '✓' : ''}</span>{x.label}{x.key && <kbd>{x.key}</kbd>}</button>)}
    </div>
  )
}
