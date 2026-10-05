import { useEffect, useMemo, useState } from 'react'
import { useStore, peek, update, createPage, toast } from './store'
import { call } from './api'
import { byType, issues, label, roles, roman, type Pages } from './derive'
import { Chip, StatusPill } from './ui'
import { openInAnimus } from './PageView'
import { questState, STATE_LABEL, type QuestState } from '../../shared/engine'
import { TYPE_INFO, type PageType, type Row } from '../../shared/schema'
import type { Page } from '../../shared/page'

/** Quests grouped by Act, in map order. */
function byAct(pages: Pages, keep: (q: Page) => boolean = () => true) {
  const groups = byType(pages, 'act').map((a) => ({ id: a.data.id, title: `Act ${roman(a.data.order ?? 0)} · ${a.data.title}`, quests: [] as Page[] }))
  const none = { id: '', title: 'No Act yet', quests: [] as Page[] }
  for (const q of byType(pages, 'quest').filter((q) => q.data.status !== 'cut' && keep(q))) (groups.find((g) => g.id === q.data.act) ?? none).quests.push(q)
  return [...groups, none].filter((g) => g.quests.length)
}

export function Ledger() {
  const pages = useStore((s) => s.pages)
  const [only, setOnly] = useState(true)
  const ths = byType(pages, 'threshold')
  const feeds = (q: Page, t: string) => ((q.data.thresholds ?? []) as Row[]).filter((r) => r.ref === t)
  const groups = byAct(pages, (q) => !only || ths.some((t) => feeds(q, t.data.id).length))
  return (
    <div className="table-view">
      <div className="toolbar"><h2>Threshold ledger</h2><label><input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} /> Only contributing quests</label>
        <span className="muted">Amber: one quest is the only contributor in that Act.</span></div>
      <div className="scroll"><table className="grid ledger">
        <thead><tr><th>Quest</th>{ths.map((t) => <th key={t.data.id} onClick={() => peek(t.data.id)}>{t.data.title}</th>)}</tr></thead>
        <tbody>{groups.map((g) => <Group key={g.id} title={g.title} span={ths.length + 1}>
          {g.quests.map((q) => <tr key={q.data.id}><th onClick={() => peek(q.data.id)}>{label(pages, q.data.id)}</th>{ths.map((t) => {
            const f = feeds(q, t.data.id)
            return <td key={t.data.id} onClick={() => peek(q.data.id)}>{f.map((r, i) => <div key={i}><span className="dot" />{r.vector ?? 'feeds'}{r.note && <small>{r.note}</small>}</div>)}</td>
          })}</tr>)}
          {g.id && <tr className="foot"><th>{g.title.split(' · ')[0]} contributors</th>{ths.map((t) => {
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
  const pages = useStore((s) => s.pages)
  const [all, setAll] = useState(false)
  const [orphans, setOrphans] = useState(false)
  const quests = byAct(pages).flatMap((g) => g.quests)
  const chars = byType(pages, 'character').map((c) => ({ c, cells: quests.map((q) => roles(q.data, c.data.id)) }))
    .map((x) => ({ ...x, n: x.cells.filter((r) => r.length).length }))
    .filter((x) => (orphans ? !x.n : all || x.n))
    .sort((a, b) => (a.c.data.tier === 'principal' ? 0 : 1) - (b.c.data.tier === 'principal' ? 0 : 1) || b.n - a.n || a.c.data.title.localeCompare(b.c.data.title))
  const addExposed = (q: Page, ch: string) => { update(q.data.id, (p) => ({ ...p, data: { ...p.data, exposed: [...(p.data.exposed ?? []), { ref: ch }] } })); toast(`Added ${pages[ch].data.title} as exposed in ${label(pages, q.data.id)}`) }
  return (
    <div className="table-view">
      <div className="toolbar"><h2>Cast matrix</h2>
        <label><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> All characters</label>
        <label><input type="checkbox" checked={orphans} onChange={(e) => setOrphans(e.target.checked)} /> Only characters in no quest</label>
        <span className="muted">I issuer · E exposed · E? exposed if a condition holds · A anchor pressure · M morale. Click an empty cell to add as exposed.</span></div>
      <div className="scroll"><table className="grid cast">
        <thead><tr><th>Character</th>{quests.map((q) => <th key={q.data.id} onClick={() => peek(q.data.id)} title={q.data.title}>{q.data.code ?? (q.data.title.length > 26 ? q.data.title.slice(0, 24) + '…' : q.data.title)}</th>)}<th>Quests</th></tr></thead>
        <tbody>{chars.map(({ c, cells, n }) => <tr key={c.data.id}><th onClick={() => peek(c.data.id)}>{c.data.title}{c.data.tier === 'principal' && <small> principal</small>}</th>
          {cells.map((r, i) => <td key={i} className={r.length ? 'has' : 'empty'} onClick={() => (r.length ? peek(quests[i].data.id) : addExposed(quests[i], c.data.id))}>{r.join(' ')}</td>)}<td>{n}</td></tr>)}</tbody>
      </table></div>
    </div>
  )
}

const ORDER: QuestState[] = ['needs', 'link', 'missing', 'duplicate', 'stub', 'built', 'none', 'unknown']
export function Handoff() {
  const { pages, engine, project } = useStore()
  const rows = byType(pages, 'quest').filter((q) => q.data.status !== 'cut' && (q.data.status === 'ready' || q.data.animus?.quest_id))
  const groups = ORDER.map((s) => ({ s, qs: rows.filter((q) => questState(q.data, engine) === s) })).filter((g) => g.qs.length)
  const missingCast = (q: Page) => new Set([...(q.data.issuer ?? []), ...(q.data.exposed ?? [])].filter((r: Row) => r.ref && pages[r.ref]?.data.type === 'character' && !engine?.characters.includes(pages[r.ref].data.animus?.character_id)).map((r: Row) => r.ref)).size
  return (
    <div className="table-view">
      <div className="toolbar"><h2>Handoff</h2><span className="muted">Quests marked Ready, and quests that name an Animus id. QuestNotes reads the game folder and never writes to it.</span></div>
      {!engine && <div className="banner">Connect your game folder to check what exists in Animus. <button onClick={() => useStore.setState({ dialog: 'settings' })}>Settings</button></div>}
      {engine?.source === 'snapshot' && <div className="banner">Engine state as of {engine.scanned}, from the committed snapshot. Connect the game folder for live state.</div>}
      {!rows.length && <p className="empty">No quest is Ready for engine yet. Set a quest's status to Ready and it appears here.</p>}
      <div className="scroll"><table className="grid">
        <thead><tr><th>Quest</th><th>Act</th><th>Status</th><th>Animus id</th><th>Issuer</th><th>Cast missing</th><th>Stages</th><th /></tr></thead>
        <tbody>{groups.map((g) => <Group key={g.s} title={STATE_LABEL[g.s]} span={8}>{g.qs.map((q) => {
          const hits = engine?.quests[q.data.animus?.quest_id] ?? []
          return <tr key={q.data.id}>
            <th onClick={() => peek(q.data.id, true)}>{label(pages, q.data.id)}</th><td>{pages[q.data.act] ? roman(pages[q.data.act].data.order) : '—'}</td><td><StatusPill s={q.data.status} /></td>
            <td>{q.data.animus?.quest_id ? `${q.data.animus.quest_id} · ${q.data.animus.kind ?? '?'}` : '—'}</td><td>{q.data.issuer?.[0]?.ref ? <Chip id={q.data.issuer[0].ref} /> : '—'}</td>
            <td>{missingCast(q) || ''}</td><td>{hits[0]?.stages.length ?? ''}</td>
            <td className="actions"><button onClick={() => peek(q.data.id, true)}>Brief</button>{hits.length === 1 && <button onClick={() => openInAnimus(hits[0].path)}>Open in Animus</button>}</td>
          </tr>
        })}</Group>)}</tbody>
      </table></div>
      {project?.game && <p className="muted small">Game folder: {project.game}</p>}
    </div>
  )
}

export function Issues() {
  const { pages, issues: imported, project } = useStore()
  const list = useMemo(() => issues(pages, imported), [pages, imported])
  const dismiss = (text: string) => { const next = imported.filter((x) => x !== text); useStore.setState({ issues: next }); call('view:write', 'issues', { open: next }) }
  const kinds = [...new Set(list.map((i) => i.kind))]
  return (
    <div className="table-view">
      <div className="toolbar"><h2>Issues</h2><span className="muted">{list.length} open</span></div>
      {project?.errors.map((e) => <div key={e.file} className="issue"><b>Unreadable file</b> {e.file}: {e.error}</div>)}
      {kinds.map((k) => <section key={k}><h4>{k}</h4>{list.filter((i) => i.kind === k).map((i, n) =>
        <div key={n} className="issue"><span>{i.text}</span>{i.id && <button onClick={() => peek(i.id!)}>Go</button>}{k === 'Import' && <button onClick={() => dismiss(i.text)}>Settled</button>}</div>)}</section>)}
      {!list.length && <p className="empty">Nothing open.</p>}
    </div>
  )
}

export function PageList({ type }: { type: PageType }) {
  const pages = useStore((s) => s.pages)
  const list = byType(pages, type)
  const [q, setQ] = useState('')
  const shown = list.filter((p) => `${p.data.code ?? ''} ${p.data.title} ${(p.data.aliases ?? []).join(' ')}`.toLowerCase().includes(q.toLowerCase()))
  return (
    <div className="table-view">
      <div className="toolbar"><h2>{TYPE_INFO[type].plural}</h2><input value={q} placeholder="Filter…" onChange={(e) => setQ(e.target.value)} />
        <button onClick={async () => peek(await createPage(type, '', type === 'act' ? { order: list.length + 1, subsections: [] } : type === 'questline' ? { order: list.length + 1, kind: 'side' } : {}))}>New {TYPE_INFO[type].label.toLowerCase()}</button></div>
      <div className="scroll"><table className="grid list"><tbody>{shown.map((p) => <tr key={p.data.id} onClick={() => peek(p.data.id)}>
        <th>{label(pages, p.data.id) || <i>Untitled</i>}</th>
        <td>{type === 'quest' ? <StatusPill s={p.data.status} /> : p.data.tier ?? (p.data.aliases ?? []).join(', ')}</td>
        <td className="muted">{type === 'character' && p.data.district ? label(pages, p.data.district) : ''}{type === 'quest' && pages[p.data.act] ? `Act ${roman(pages[p.data.act].data.order)}` : ''}</td>
      </tr>)}</tbody></table></div>
    </div>
  )
}

export function Trash() {
  const [list, setList] = useState<Page[]>([])
  const refresh = () => call('trash:list').then(setList)
  useEffect(() => { refresh() }, [])
  return (
    <div className="table-view">
      <div className="toolbar"><h2>Trash</h2>{list.length > 0 && <button className="danger" onClick={async () => { if (confirm(`Delete ${list.length} pages for good?`)) { await call('trash:empty'); refresh() } }}>Empty Trash</button>}</div>
      {!list.length && <p className="empty">The Trash is empty.</p>}
      <table className="grid list"><tbody>{list.map((p) => <tr key={p.file}><th>{p.data.title}</th><td>{TYPE_INFO[p.data.type]?.label}</td>
        <td><button onClick={async () => { await call('page:restore', p.file); useStore.setState({ pages: { ...useStore.getState().pages, [p.data.id]: p } }); refresh() }}>Restore</button></td></tr>)}</tbody></table>
    </div>
  )
}
