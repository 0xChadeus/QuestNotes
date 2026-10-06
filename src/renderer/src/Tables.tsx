import { useEffect, useMemo, useState } from 'react'
import { useStore, peek, update, createPage, toast, trashPage, trashPages, reorder, restorePage, lastChange, undo, setBinned, pruneMap } from './store'
import { call } from './api'
import { byType, issues, kindLabel, label, roles, roman, type Pages } from './derive'
import { Chip, StatusPill, openMenu, pageMenu } from './ui'
import { openInEngine } from './PageView'
import { opensInEditor, questState, stateLabel, type QuestState } from '../../shared/engine'
import { castFields, castKind, extraKey, giverField, kindOf, STATUSES, type Row } from '../../shared/schema'
import type { Page } from '../../shared/page'

/** Quests grouped by Act, in map order. */
function byAct(pages: Pages, keep: (q: Page) => boolean = () => true) {
  const groups = byType(pages, 'act').map((a) => ({ id: a.data.id, title: `Act ${roman(a.data.order ?? 0)} · ${a.data.title}`, quests: [] as Page[] }))
  const none = { id: '', title: 'No Act yet', quests: [] as Page[] }
  for (const q of byType(pages, 'quest').filter((q) => q.data.status !== 'cut' && keep(q))) (groups.find((g) => g.id === q.data.act) ?? none).quests.push(q)
  return [...groups, none].filter((g) => g.quests.length)
}

/** Quests against the pages of one kind that a quest field names, as questnotes.yaml's `matrix` describes. */
export function Matrix() {
  const { pages, schema } = useStore()
  const [only, setOnly] = useState(true)
  const m = schema.matrix!
  const f = schema.fields.quest.find((x) => x.key === m.field)
  const cols = byType(pages, m.kind)
  const feeds = (q: Page, t: string) => ((q.data[m.field] ?? []) as Row[]).filter((r) => r.ref === t)
  const shown = (r: Row) => (f?.extras ?? []).map(extraKey).filter((k) => k !== 'note').map((k) => r[k]).find(Boolean) ?? ''
  const groups = byAct(pages, (q) => !only || cols.some((t) => feeds(q, t.data.id).length))
  return (
    <div className="table-view">
      <div className="toolbar"><h2>{m.title}</h2><label><input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} /> Only quests that name one</label>
        <span className="muted">Amber: one quest is the only one in that Act.</span></div>
      <div className="scroll"><table className="grid matrix">
        <thead><tr><th>Quest</th>{cols.map((t) => <th key={t.data.id} onClick={() => peek(t.data.id)}>{t.data.title}</th>)}</tr></thead>
        <tbody>{groups.map((g) => <Group key={g.id} title={g.title} span={cols.length + 1}>
          {g.quests.map((q) => <tr key={q.data.id}><th onClick={() => peek(q.data.id)}>{label(pages, q.data.id)}</th>{cols.map((t) =>
            <td key={t.data.id} onClick={() => peek(q.data.id)}>{feeds(q, t.data.id).map((r, i) => <div key={i}><span className="dot" />{shown(r)}{r.note && <small>{r.note}</small>}</div>)}</td>)}</tr>)}
          {g.id && <tr className="foot"><th>{g.title.split(' · ')[0]} quests</th>{cols.map((t) => {
            const n = g.quests.filter((q) => feeds(q, t.data.id).length)
            return <td key={t.data.id} className={n.length === 1 ? 'alone' : ''}>{n.length}{n.length === 1 && ` · only ${n[0].data.code ?? n[0].data.title}`}</td>
          })}</tr>}
        </Group>)}</tbody>
      </table></div>
    </div>
  )
}
const Group = ({ title, span, children }: { title: string; span: number; children: React.ReactNode }) => <><tr className="group"><th colSpan={span}>{title}</th></tr>{children}</>

export function Cast() {
  const { pages, schema } = useStore()
  const [all, setAll] = useState(false)
  const [orphans, setOrphans] = useState(false)
  const kind = castKind(schema)
  const fields = castFields(schema)
  const add = fields.find((f) => !f.giver) ?? fields[0]
  const quests = byAct(pages).flatMap((g) => g.quests)
  const people = byType(pages, kind).map((c) => ({ c, cells: quests.map((q) => roles(schema, q.data, c.data.id)) }))
    .map((x) => ({ ...x, n: x.cells.filter((r) => r.length).length }))
    .filter((x) => (orphans ? !x.n : all || x.n))
    .sort((a, b) => b.n - a.n || a.c.data.title.localeCompare(b.c.data.title))
  const addTo = (q: Page, ch: string) => { update(q.data.id, (p) => ({ ...p, data: { ...p.data, [add.key]: [...(p.data[add.key] ?? []), { ref: ch }] } })); const c = lastChange(); toast(`Added ${pages[ch].data.title} to ${add.label} in ${label(pages, q.data.id)}`, { label: 'Undo', run: () => undo(c) }) }
  const plural = kindOf(schema, kind)?.plural ?? kind
  return (
    <div className="table-view">
      <div className="toolbar"><h2>Cast</h2>
        <label><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> All {plural.toLowerCase()}</label>
        <label><input type="checkbox" checked={orphans} onChange={(e) => setOrphans(e.target.checked)} /> Only those in no quest</label>
        <span className="muted">{fields.map((f) => `${f.glyph} ${f.label.toLowerCase()}`).join(' · ')} · ? only if a condition holds.{add && ` Click an empty cell to add to ${add.label}.`}</span></div>
      <div className="scroll"><table className="grid cast">
        <thead><tr><th>{kindLabel(schema, kind)}</th>{quests.map((q) => <th key={q.data.id} onClick={() => peek(q.data.id)} title={q.data.title}>{q.data.code ?? (q.data.title.length > 26 ? q.data.title.slice(0, 24) + '…' : q.data.title)}</th>)}<th>Quests</th></tr></thead>
        <tbody>{people.map(({ c, cells, n }) => <tr key={c.data.id}><th onClick={() => peek(c.data.id)}>{c.data.title}</th>
          {cells.map((r, i) => <td key={i} className={r.length ? 'has' : 'empty'} onClick={() => (r.length || !add ? peek(quests[i].data.id) : addTo(quests[i], c.data.id))}>{r.join(' ')}</td>)}<td>{n}</td></tr>)}</tbody>
      </table></div>
    </div>
  )
}

const ORDER: QuestState[] = ['needs', 'link', 'missing', 'duplicate', 'stub', 'built', 'none', 'unknown']
export function Handoff() {
  const { pages, engine, project, schema } = useStore()
  const name = schema.engine?.name ?? 'the engine'
  const giver = giverField(schema)
  const kind = castKind(schema)
  const rows = byType(pages, 'quest').filter((q) => q.data.status !== 'cut' && (q.data.status === 'ready' || q.data.engine?.id))
  const groups = ORDER.map((s) => ({ s, qs: rows.filter((q) => questState(q.data, engine) === s) })).filter((g) => g.qs.length)
  const missingCast = (q: Page) => new Set(castFields(schema).flatMap((f) => (q.data[f.key] ?? []) as Row[])
    .filter((r) => r.ref && pages[r.ref]?.data.type === kind && !engine?.characters.includes(pages[r.ref].data.engine?.id)).map((r) => r.ref)).size
  return (
    <div className="table-view">
      <div className="toolbar"><h2>Handoff</h2><span className="muted">Quests marked Ready, and quests linked to {name}. QuestNotes reads the game folder and never writes to it.</span></div>
      {!schema.engine && <div className="banner">No engine link. Name your engine in the project settings to see which quests exist there. <button onClick={() => useStore.setState({ dialog: 'project' })}>Project settings</button></div>}
      {schema.engine && !engine && <div className="banner">Connect your game folder to check what exists in {name}. <button onClick={() => useStore.setState({ dialog: 'settings' })}>Settings</button></div>}
      {engine?.source === 'snapshot' && <div className="banner">Engine state as of {engine.scanned}, from the committed snapshot. Connect the game folder for live state.</div>}
      {!rows.length && <p className="empty">No quest is Ready for engine yet. Set a quest's status to Ready and it appears here.</p>}
      <div className="scroll"><table className="grid">
        <thead><tr><th>Quest</th><th>Act</th><th>Status</th><th>{schema.engine?.name ?? 'Engine'} id</th><th>{giver?.label ?? ''}</th><th>Cast missing</th><th>Stages</th><th /></tr></thead>
        <tbody>{groups.map((g) => <Group key={g.s} title={stateLabel(g.s, name)} span={8}>{g.qs.map((q) => {
          const hits = engine?.quests[q.data.engine?.id] ?? []
          const by = giver && q.data[giver.key]?.[0]?.ref
          return <tr key={q.data.id}>
            <th onClick={() => peek(q.data.id, true)}>{label(pages, q.data.id)}</th><td>{pages[q.data.act] ? roman(pages[q.data.act].data.order) : '—'}</td><td><StatusPill s={q.data.status} /></td>
            <td>{q.data.engine?.id ? `${q.data.engine.id}${q.data.engine.kind ? ` · ${q.data.engine.kind}` : ''}` : '—'}</td><td>{by ? <Chip id={by} /> : '—'}</td>
            <td>{missingCast(q) || ''}</td><td>{hits[0]?.stages.length ?? ''}</td>
            <td className="actions"><button onClick={() => peek(q.data.id, true)}>Brief</button>{hits.length === 1 && opensInEditor(schema.engine) && <button onClick={() => openInEngine(hits[0].path)}>Open in {name}</button>}</td>
          </tr>
        })}</Group>)}</tbody>
      </table></div>
      {project?.game && <p className="muted small">Game folder: {project.game}</p>}
    </div>
  )
}

export function Issues() {
  const { pages, issues: imported, project, schema } = useStore()
  const list = useMemo(() => issues(schema, pages, imported), [schema, pages, imported])
  const dismiss = (text: string) => { const next = imported.filter((x) => x !== text); useStore.setState({ issues: next }); call('view:write', 'issues', { open: next }) }
  const kinds = [...new Set(list.map((i) => i.kind))]
  return (
    <div className="table-view">
      <div className="toolbar"><h2>Issues</h2><span className="muted">{list.length} open</span></div>
      {project?.errors.map((e) => <div key={e.file} className="issue">{e.file.endsWith('/') ? <><b>Hidden pages</b> {e.error}.
        <button onClick={() => useStore.setState({ dialog: 'project' })}>Project settings</button></> : <><b>Unreadable file</b> {e.file}: {e.error}</>}</div>)}
      {kinds.map((k) => <section key={k}><h4>{k}</h4>{list.filter((i) => i.kind === k).map((i, n) =>
        <div key={n} className="issue"><span>{i.text}</span>{i.id && <button onClick={() => peek(i.id!)}>Go</button>}{k === 'Import' && <button onClick={() => dismiss(i.text)}>Settled</button>}</div>)}</section>)}
      {!list.length && <p className="empty">Nothing open.</p>}
    </div>
  )
}

export function PageList({ type }: { type: string }) {
  const { pages, schema, selected, multi } = useStore()
  const list = byType(pages, type)
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<{ col: number; dir: 1 | -1 } | null>(null)
  const fields = schema.fields[type] ?? []
  const select = fields.find((f) => f.kind === 'select'), ref = fields.find((f) => f.kind === 'ref')
  const k = kindOf(schema, type), ordered = type === 'act' || type === 'questline'
  const name = (p: Page) => label(pages, p.data.id) || 'Untitled'
  // Columns: a header, and the text each row shows (and sorts by) under it.
  const cols: [string, (p: Page) => string][] = type === 'quest'
    ? [['Quest', name], ['Status', (p) => String(STATUSES.indexOf(p.data.status ?? 'idea'))], ['Act', (p) => (pages[p.data.act] ? label(pages, p.data.act) : '')], ['Questline', (p) => pages[p.data.questline]?.data.title ?? '']]
    : [[k?.label ?? type, name], [select?.label ?? 'Aliases', (p) => (select && p.data[select.key]) ?? (p.data.aliases ?? []).join(', ')],
      ...(ref ? [[ref.label, (p: Page) => (p.data[ref.key] ? label(pages, p.data[ref.key]) : '')] as [string, (p: Page) => string]] : [])]
  const shown = list.filter((p) => `${p.data.code ?? ''} ${p.data.title} ${(p.data.aliases ?? []).join(' ')}`.toLowerCase().includes(q.toLowerCase()))
  if (sort) shown.sort((a, b) => sort.dir * cols[sort.col][1](a).localeCompare(cols[sort.col][1](b), undefined, { numeric: true }))
  // The checked rows are the app's picked set, so Delete and 1 to 5 act on all of them.
  const picked = new Set(multi)
  const setPicked = (ids: string[]) => useStore.setState({ multi: ids })
  const toggle = (id: string) => setPicked(picked.has(id) ? multi.filter((x) => x !== id) : [...multi, id])
  const live = multi.filter((id) => pages[id])
  const all = shown.length > 0 && shown.every((p) => picked.has(p.data.id))
  return (
    <div className="table-view">
      <div className="toolbar"><h2>{k?.plural ?? type}</h2>
        <input value={q} placeholder="Filter… (Ctrl F)" onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); setQ(''); e.currentTarget.blur() } }} />
        <button onClick={async () => peek(await createPage(type, ''))}>New {(k?.label ?? type).toLowerCase()}</button>
        {live.length > 0 && <span className="bulk">{live.length} selected
          <button className="danger" title="Delete" onClick={async () => { await trashPages(live); setPicked([]) }}>Move to Trash</button>
          <button onClick={() => setPicked([])}>Clear</button></span>}</div>
      {!list.length && <p className="empty">No {(k?.plural ?? type).toLowerCase()} yet.</p>}
      {list.length > 0 && <div className="scroll"><table className="grid list"><thead><tr>
        <th className="pick"><input type="checkbox" title="Select all shown" checked={all} onChange={() => setPicked(all ? [] : shown.map((p) => p.data.id))} /></th>
        {cols.map(([h], i) => <th key={h} title="Sort by this column" onClick={() => setSort(sort?.col === i ? (sort.dir === 1 ? { col: i, dir: -1 } : null) : { col: i, dir: 1 })}>{h}{sort?.col === i ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}</th>)}<th /></tr></thead>
        <tbody>{shown.map((p, i) => <tr key={p.data.id} className={selected === p.data.id || picked.has(p.data.id) ? 'sel' : ''} onContextMenu={(e) => openMenu(e, pageMenu(p.data.id))}
          onClick={(e) => (e.ctrlKey || e.metaKey || e.shiftKey ? toggle(p.data.id) : peek(p.data.id))}>
          <td className="pick" onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={picked.has(p.data.id)} onChange={() => toggle(p.data.id)} /></td>
          {cols.map(([h, show], c) => c === 0 ? <th key={h}>{label(pages, p.data.id) || <i>Untitled</i>}</th>
            : <td key={h} className={c > 1 ? 'muted' : ''}>{type === 'quest' && c === 1 ? <StatusPill s={p.data.status} /> : show(p)}</td>)}
          <td className="row-actions" onClick={(e) => e.stopPropagation()}>
            {ordered && !q && !sort && <><button className="mini" title="Move earlier" disabled={i === 0} onClick={() => reorder(p.data.id, -1)}>↑</button><button className="mini" title="Move later" disabled={i === shown.length - 1} onClick={() => reorder(p.data.id, 1)}>↓</button></>}
            <button className="mini" title="More (right-click)" onClick={(e) => openMenu(e, pageMenu(p.data.id))}>⋯</button>
            <button className="mini danger" title="Move to Trash (Delete)" onClick={() => trashPage(p.data.id)}>Delete</button></td>
        </tr>)}</tbody></table></div>}
    </div>
  )
}

export function Trash() {
  const [list, setList] = useState<Page[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const { schema, pages } = useStore()
  const refresh = () => call('trash:list').then((l) => { setList(l); setBinned(l.map((p) => p.data.id)); pruneMap(l.map((p) => p.data.id)) })
  useEffect(() => { refresh() }, [])
  const forever = async (p: Page) => { if (confirm(`Delete “${p.data.title || 'Untitled'}” for good? This cannot be undone.`)) { await call('trash:delete', p.file); refresh() } }
  return (
    <div className="table-view">
      <div className="toolbar"><h2>Trash</h2>{list.length > 0 && <><span className="muted">{list.length} page{list.length > 1 ? 's' : ''}. Click one to read it.</span>
        <button className="danger" onClick={async () => { if (confirm(`Delete ${list.length} pages for good? This cannot be undone.`)) { await call('trash:empty'); refresh() } }}>Empty Trash</button></>}</div>
      {!list.length && <p className="empty">The Trash is empty. Deleted pages wait here until you empty it.</p>}
      <table className="grid list"><tbody>{list.flatMap((p) => {
        const taken = !!pages[p.data.id]
        return [<tr key={p.file} onClick={() => setOpen(open === p.file ? null : p.file)}><th>{open === p.file ? '▾ ' : '▸ '}{p.data.title || <i>Untitled</i>}</th><td>{kindLabel(schema, p.data.type)}</td>
          <td className="row-actions always" onClick={(e) => e.stopPropagation()}>
            <button disabled={taken} title={taken ? 'A page with the same id exists; rename or delete that one first' : 'Put it back'} onClick={async () => { await restorePage(p); refresh() }}>Restore</button>
            <button className="danger" onClick={() => forever(p)}>Delete forever</button></td></tr>,
          ...(open === p.file ? [<tr key={`${p.file}:body`} className="preview"><td colSpan={3}><pre>{p.body.trim() || '(no text)'}</pre></td></tr>] : [])]
      })}</tbody></table>
    </div>
  )
}
