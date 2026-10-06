import { useMemo, useState } from 'react'
import { useStore, setData, peek, openFull, trashPage, toast, showOnMap, duplicate, ask, renameSubsection, removeSubsection } from './store'
import { call } from './api'
import { Editor } from './Editor'
import { Chip, EngineBadge, Picker, openMenu, pageMenu } from './ui'
import { byType, completeness, derive, kindLabel, label, roles, roman } from './derive'
import { castKind, extraKey, giverField, STATUSES, STATUS_LABEL, type Field, type Row } from '../../shared/schema'
import { characterState, opensInEditor, questState, stateLabel, suggestCharacterId, suggestQuestId } from '../../shared/engine'
import { HONORIFIC, today, type Page } from '../../shared/page'

export function PageView({ id, inPeek }: { id: string; inPeek?: boolean }) {
  const p = useStore((s) => s.pages[id])
  const schema = useStore((s) => s.schema)
  const [adding, setAdding] = useState(false)
  if (!p) return <div className="empty">This page is no longer here.</div>
  const d = p.data
  const fields = schema.fields[d.type] ?? []
  const shown = fields.filter((f) => !f.optional || hasValue(d[f.key]) || adding)
  const set = (patch: object) => setData(id, patch)
  return (
    <article className={`page t-${d.type}`}>
      <header className="page-head">
        <div className="kind">{kindLabel(schema, d.type)}{d.type === 'act' && d.order ? ` ${roman(d.order)}` : ''}
          <button className="more" title="More actions" onClick={(e) => openMenu(e, pageMenu(id))}>⋯</button></div>
        <div className="titles">
          {d.type === 'quest' && <input className="code" value={d.code ?? ''} placeholder="Code" onChange={(e) => set({ code: e.target.value })} />}
          <input className="title" value={d.title} placeholder="Title" autoFocus={!d.title} onChange={(e) => set({ title: e.target.value })} spellCheck />
        </div>
        {d.type === 'quest' && <>
          <input className="synopsis" value={d.synopsis ?? ''} placeholder="One line for the map card" onChange={(e) => set({ synopsis: e.target.value })} spellCheck />
          <div className="status-row">
            <div className="seg">{STATUSES.map((s) => <button key={s} className={d.status === s ? `on s-${s}` : ''} onClick={() => setData(id, { status: s }, `Set ${d.title || 'quest'} to ${STATUS_LABEL[s]}`)}>{STATUS_LABEL[s]}</button>)}</div>
            <Completeness p={p} />
          </div>
        </>}
      </header>
      {schema.engine && (d.type === 'quest' || d.type === castKind(schema)) && <EngineBox p={p} />}
      <section className="fields">
        {shown.filter((f) => !f.effect).map((f) => <FieldView key={f.key} p={p} f={f} />)}
        {fields.some((f) => f.optional && !hasValue(d[f.key])) && !adding && <button className="link" onClick={() => setAdding(true)}>+ Add field</button>}
      </section>
      {fields.some((f) => f.effect) && <section className="fields effects"><h4>Effects</h4>{fields.filter((f) => f.effect).map((f) => <FieldView key={f.key} p={p} f={f} />)}</section>}
      <Editor id={id} />
      <Related p={p} />
      <footer className="page-actions">
        {inPeek && <button onClick={() => openFull(id)}>Open full <kbd>Ctrl Enter</kbd></button>}
        {d.type === 'quest' && <button onClick={() => showOnMap(id)}>Show on map</button>}
        <button onClick={() => duplicate(id)}>Duplicate</button>
        <button onClick={() => call('shell:open', p.file)}>Open in another editor</button>
        <button className="danger" onClick={() => trashPage(id)}>Move to Trash</button>
      </footer>
    </article>
  )
}
const hasValue = (v: unknown) => v !== undefined && v !== '' && !(Array.isArray(v) && !v.length)

function Completeness({ p }: { p: Page }) {
  const c = completeness(useStore((s) => s.schema), p)
  return <span className={`complete${c.done === c.total ? ' full' : ''}`} title={c.missing.length ? `Missing: ${c.missing.join(', ')}` : 'Complete'}>{c.done} of {c.total}</span>
}

function FieldView({ p, f }: { p: Page; f: Field }) {
  const v = p.data[f.key]
  const set = (x: unknown) => setData(p.data.id, { [f.key]: x })
  const [pick, setPick] = useState(false)
  const pages = useStore((s) => s.pages)
  let input
  if (f.kind === 'text' || f.kind === 'number') input = <input type={f.kind} value={v ?? ''} onChange={(e) => set(f.kind === 'number' ? (e.target.value === '' ? undefined : +e.target.value) : e.target.value)} />
  else if (f.kind === 'long') input = <textarea value={v ?? ''} rows={3} onChange={(e) => set(e.target.value)} spellCheck />
  else if (f.kind === 'select') input = <select value={v ?? ''} onChange={(e) => set(e.target.value || undefined)}><option value="">—</option>{f.options!.map((o) => <option key={o}>{o}</option>)}</select>
  else if (p.data.type === 'act' && f.key === 'subsections') input = <Subsections p={p} />
  else if (f.kind === 'tags') input = <input value={(v ?? []).join(', ')} placeholder="Comma-separated" onChange={(e) => set(e.target.value.split(/,\s*/))} />
  else if (f.kind === 'subsection') {
    const subs: string[] = pages[p.data.act]?.data.subsections ?? []
    input = <select value={v ?? ''} onChange={(e) => set(e.target.value || undefined)} disabled={!subs.length}><option value="">—</option>{subs.map((s) => <option key={s}>{s}</option>)}</select>
  } else if (f.kind === 'ref') input = <span className="ref">{v ? <Chip id={v} onRemove={() => set(undefined)} /> : <button className="link" onClick={() => setPick(true)}>Choose…</button>}{pick && <Picker types={f.to!} onPick={set} onClose={() => setPick(false)} />}</span>
  else input = <Rows p={p} f={f} />
  return <div className={`field k-${f.kind}`}><label>{f.label}</label>{input}</div>
}

/** An act's sub-sections, one per line: renaming or removing one carries its quests along. */
function Subsections({ p }: { p: Page }) {
  const subs: string[] = (p.data.subsections ?? []).filter(Boolean)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const commit = (x: string) => {
    const v = draft[x]?.trim()
    setDraft((d) => { const n = { ...d }; delete n[x]; return n })
    if (v && v !== x) { if (subs.includes(v)) toast(`${p.data.title} already has a sub-section called ${v}.`); else renameSubsection(p.data.id, x, v) }
  }
  const swap = (i: number, j: number) => { const n = [...subs]; [n[i], n[j]] = [n[j], n[i]]; setData(p.data.id, { subsections: n }, `Move ${subs[i]}`) }
  return (
    <div className="rows">
      {subs.map((x, i) => <div key={x} className="row">
        <input className="free" value={draft[x] ?? x} onChange={(e) => setDraft({ ...draft, [x]: e.target.value })} onBlur={() => commit(x)} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} spellCheck />
        <button className="mini" title="Move earlier" disabled={i === 0} onClick={() => swap(i, i - 1)}>↑</button>
        <button className="mini" title="Move later" disabled={i === subs.length - 1} onClick={() => swap(i, i + 1)}>↓</button>
        <button className="x" title="Remove; its quests move to the first column" onClick={() => removeSubsection(p.data.id, x)}>×</button></div>)}
      <span className="ref"><button className="link" onClick={() => ask({ title: `New sub-section of ${p.data.title}`, value: '', ok: 'Add',
        run: (v) => subs.includes(v) ? toast(`${p.data.title} already has ${v}.`) : setData(p.data.id, { subsections: [...subs, v] }, `Add ${v}`) })}>+ Add sub-section</button></span>
    </div>
  )
}

function Rows({ p, f }: { p: Page; f: Field }) {
  const rows: Row[] = p.data[f.key] ?? []
  const [pick, setPick] = useState(false)
  const set = (next: Row[]) => setData(p.data.id, { [f.key]: next })
  const patch = (i: number, r: Partial<Row>) => set(rows.map((x, n) => (n === i ? { ...x, ...r } : x)))
  const swap = (i: number, j: number) => { const n = [...rows]; [n[i], n[j]] = [n[j], n[i]]; set(n) }
  const menu = (e: React.MouseEvent, i: number) => openMenu(e, [
    ...(rows[i].ref ? [{ label: 'Open', run: () => peek(rows[i].ref!) }, '-' as const] : []),
    { label: 'Move up', run: () => i > 0 && swap(i, i - 1) }, { label: 'Move down', run: () => i < rows.length - 1 && swap(i, i + 1) },
    '-', { label: 'Remove', danger: true, run: () => set(rows.filter((_, n) => n !== i)) },
  ])
  return (
    <div className="rows">
      {rows.map((r, i) => (
        <div key={i} className="row" onContextMenu={(e) => !(e.target as HTMLElement).closest('input, textarea, select') && menu(e, i)}>
          {r.ref ? <Chip id={r.ref} /> : r.none ? <span className="none">None</span> : <input className="free" value={r.text ?? ''} placeholder="Free text" onChange={(e) => patch(i, { text: e.target.value })} />}
          {(f.extras ?? []).map((x) => { const k = extraKey(x); return typeof x === 'object'
            ? <select key={k} className={r[k] ? '' : 'empty'} value={r[k] ?? ''} onChange={(e) => patch(i, { [k]: e.target.value || undefined })}><option value="">{k}</option>{x.options.map((o) => <option key={o}>{o}</option>)}</select>
            : <input key={k} className={`x-${k}`} value={r[k] ?? ''} placeholder={k} onChange={(e) => patch(i, { [k]: e.target.value })} spellCheck /> })}
          <button className="x" title="Remove" onClick={() => set(rows.filter((_, n) => n !== i))}>×</button>
        </div>
      ))}
      <span className="ref"><button className="link" onClick={() => setPick(true)}>+ Add</button>
        {pick && <Picker types={f.to!} onClose={() => setPick(false)} onPick={(ref) => set([...rows, { ref }])}
          extra={[{ label: 'None (an explicit none)', run: () => set([...rows, { none: true }]) }, { label: 'Free text', run: (q) => set([...rows, { text: q }]) }]} />}</span>
    </div>
  )
}

function EngineBox({ p }: { p: Page }) {
  const { engine, pages, schema } = useStore()
  const [linking, setLinking] = useState(false)
  const e = schema.engine!
  const d = p.data
  const a = d.engine ?? {}
  const set = (patch: object) => setData(d.id, { engine: { ...a, ...patch } })
  if (d.type !== 'quest') {
    const giver = giverField(schema)
    const needed = !!giver && byType(pages, 'quest').some((q) => q.data.status === 'ready' && (q.data[giver.key] ?? []).some((r: Row) => r.ref === d.id))
    const s = characterState(d, engine, needed)
    const text = { unknown: 'No engine data', in: `In ${e.name}`, needs: `Needs creating in ${e.name}`, none: 'Not in engine' }[s]
    const sugg = suggestCharacterId(d, engine)
    return <div className={`engine-box tone-${s === 'needs' ? 'amber' : s === 'in' ? 'green' : 'grey'}`}><EngineBadge state={s === 'in' ? 'built' : s === 'needs' ? 'needs' : 'none'} text={text} />
      <label>{e.name} id <input value={a.id ?? ''} placeholder={d.title.replace(HONORIFIC, '').split(' ')[0].toLowerCase()} onChange={(x) => set({ id: x.target.value || undefined })} /></label>
      {sugg && <button onClick={() => set({ id: sugg })}>Link to “{sugg}”</button>}</div>
  }
  const state = questState(d, engine)
  const hits = a.id ? engine?.quests[a.id] ?? [] : []
  const kinds = e.quests?.kinds ?? []
  return (
    <div className={`engine-box tone-${state === 'needs' ? 'amber' : ['missing', 'duplicate'].includes(state) ? 'red' : state === 'link' ? 'blue' : 'grey'}`}>
      <EngineBadge state={state} text={stateLabel(state, e.name, hits)} />
      <label>{e.name} id <input value={a.id ?? ''} placeholder={suggestQuestId(d.code ?? '', d.title)} onChange={(x) => set({ id: x.target.value.trim() || undefined, linked_on: undefined })} /></label>
      {kinds.length > 0 && <select value={a.kind ?? ''} onChange={(x) => set({ kind: x.target.value || undefined })}><option value="">kind</option>{kinds.map((k) => <option key={k}>{k}</option>)}</select>}
      {state === 'link' && <button onClick={() => set({ linked_on: today(), kind: hits[0].kind || undefined })} title={`${e.name} calls it “${hits[0].title}”, ${hits[0].stages.length} stages`}>Link to “{hits[0].title}”</button>}
      {engine && <span className="ref"><button onClick={() => setLinking(true)}>Link…</button>{linking && <EnginePicker onClose={() => setLinking(false)} onPick={(id, kind) => set({ id, kind: kind || undefined, linked_on: today() })} />}</span>}
      {hits.length === 1 && opensInEditor(e) && <button onClick={() => openInEngine(hits[0].path)}>Open in {e.name}</button>}
      <button onClick={() => peek(d.id, true)}>Handoff brief</button>
      {hits.length === 1 && opensInEditor(e) && hits[0].stages.length > 1 && <details><summary>{hits[0].stages.length} stages</summary>{hits[0].stages.map((s) => <button key={s} className="mini" onClick={() => openInEngine(hits[0].path, s)}>{s}</button>)}</details>}
    </div>
  )
}

function EnginePicker({ onPick, onClose }: { onPick: (id: string, kind: string) => void; onClose: () => void }) {
  const engine = useStore((s) => s.engine)
  const [q, setQ] = useState('')
  const list = Object.entries(engine?.quests ?? {}).filter(([k, v]) => `${k} ${v[0].title}`.toLowerCase().includes(q.toLowerCase()))
  return <div className="picker"><input autoFocus value={q} placeholder="Engine quests…" onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() } }} />
    <ul>{list.map(([k, v]) => <li key={k} onMouseDown={() => { onPick(k, v[0].kind); onClose() }}>{k} · {v[0].title}<small>{v[0].stages.length} stages{v[0].kind && ` · ${v[0].kind}`}</small></li>)}</ul></div>
}

export async function openInEngine(path: string, stage?: string) {
  const name = useStore.getState().schema.engine?.name ?? 'the engine'
  const r = await call('engine:open', path, stage)
  if (r.ok) toast(r.started ? 'Starting Godot. The quest opens when the editor is ready.' : `Opened ${path.split('/').pop()} in ${name}. Switch to Godot.`)
  else toast({ 'no-game': 'Choose the game folder in Settings first.', 'no-godot': 'Set the Godot executable in Settings first.', not_found: `${name} has no such file any more.` }[r.error ?? ''] ?? `Godot did not open it (${r.error}).`)
}

function Related({ p }: { p: Page }) {
  const { pages, schema } = useStore()
  const { backlinks, incoming } = useMemo(() => derive(schema, pages), [schema, pages])
  const id = p.data.id
  const quests = p.data.type === castKind(schema) ? byType(pages, 'quest').map((q) => ({ q, r: roles(schema, q.data, id) })).filter((x) => x.r.length) : []
  const back = [...(backlinks.get(id) ?? [])].filter((x) => pages[x])
  const setups = incoming.get(id) ?? []
  const leadsFrom = byType(pages, 'quest').filter((q) => (q.data.leads_to ?? []).some((r: Row) => r.ref === id))
  return (
    <section className="related">
      {setups.length > 0 && <><h4>Set up earlier</h4>{setups.map((s, i) => <div key={i} className="setup"><Chip id={s.from} /> {s.condition} <span className="muted">→ {s.outcome}</span></div>)}</>}
      {leadsFrom.length > 0 && <><h4>Leads from</h4><div className="chips">{leadsFrom.map((q) => <Chip key={q.data.id} id={q.data.id} />)}</div></>}
      {quests.length > 0 && <><h4>In quests</h4><table className="mini-table"><tbody>{quests.map(({ q, r }) =>
        <tr key={q.data.id} onClick={() => peek(q.data.id)}><td>{label(pages, q.data.id)}</td><td>{pages[q.data.act] ? `Act ${roman(pages[q.data.act].data.order)}` : ''}</td><td>{r.join(' ')}</td></tr>)}</tbody></table></>}
      <h4>Mentioned in</h4>
      {back.length ? <div className="chips">{back.map((b) => <Chip key={b} id={b} />)}</div> : <p className="muted">No page links here yet.</p>}
    </section>
  )
}
