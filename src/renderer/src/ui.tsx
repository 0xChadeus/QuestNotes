import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useStore, peek, toggleFilter, createPage } from './store'
import { kindLabel, label } from './derive'
import { kindOf, STATUS_LABEL, type Schema, type Status } from '../../shared/schema'
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
          if (e.key === 'Escape') onClose()
        }} />
      <ul>{items.map((it, n) => <li key={it.key} className={n === i ? 'on' : ''} onMouseDown={() => pick(n)}>{it.label}<small>{it.kind}</small></li>)}</ul>
    </div>
  )
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts)
  return <div className="toasts">{toasts.map((t) => <div key={t.id} className="toast">{t.text}{t.action && <button onClick={() => { t.action!.run(); useStore.setState({ toasts: useStore.getState().toasts.filter((x) => x !== t) }) }}>{t.action.label}</button>}</div>)}</div>
}

export const copy = (text: string) => navigator.clipboard.writeText(text)
export const Copy = ({ text }: { text: string }) => <button className="mini" onClick={() => copy(text)}>Copy</button>
