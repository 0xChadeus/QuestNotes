// The handoff brief: what an engine designer builds for one quest. Read-only; QuestNotes never writes game files.
import { useEffect, useState } from 'react'
import { useStore, peek } from './store'
import { call } from './api'
import { Copy, EngineBadge, copy } from './ui'
import { label } from './derive'
import { openInEngine } from './PageView'
import { characterState, opensInEditor, questPath, questState, stateLabel, suggestCharacterId, suggestQuestId } from '../../shared/engine'
import { branches, type Page } from '../../shared/page'
import { castFields, extraKey, giverField, type Row } from '../../shared/schema'

const section = (body: string, name: string) => new RegExp(`^#{2,3} ${name}\\s*\\n+([\\s\\S]*?)(?=\\n#{1,3} |$)`, 'mi').exec(body)?.[1].trim() ?? ''
const firstProse = (body: string) => /^(?!#|\||>|\s*$)(.+)$/m.exec(body)?.[1] ?? ''
const plain = (md: string, pages: Record<string, Page>) => md.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, id, l) => l ?? label(pages, id)).replace(/^> /gm, '').replace(/\\\|/g, '|')

export function Brief({ id }: { id: string }) {
  const { pages, engine, schema } = useStore()
  const [history, setHistory] = useState<string[]>([])
  const q = pages[id]
  const a = q?.data.engine ?? {}
  useEffect(() => { if (q && a.handoff_on) call('git:history', q.file, a.handoff_on).then(setHistory, () => setHistory([])) }, [q?.file, a.handoff_on])
  if (!q) return null
  const d = q.data
  const e = schema.engine
  const name = e?.name ?? 'the engine'
  const qid = a.id ?? suggestQuestId(d.code ?? '', d.title)
  const kinds = e?.quests?.kinds ?? []
  const kind = a.kind ?? [pages[d.questline]?.data.kind].find((k) => kinds.includes(k)) ?? kinds[0] ?? ''
  const path = questPath(e, kind, qid)
  const state = questState(d, engine)
  const hits = engine?.quests[a.id] ?? []
  const summary = d.synopsis || plain(firstProse(q.body), pages)
  const castMap = new Map<string, string[]>()
  for (const f of castFields(schema)) for (const r of (d[f.key] ?? []) as Row[])
    if (r.ref && pages[r.ref]) castMap.set(r.ref, [...(castMap.get(r.ref) ?? []), r.condition ? `${f.label}, ${r.condition}` : f.label])
  const cast = [...castMap].map(([ref, roles]) => ({ ref, role: roles.join('; ') }))
  const show = (r: Row, extras: string[]) => { const q = extras.filter((k) => k !== 'note' && r[k]).map((k) => r[k]).join(', '); return `${r.none ? 'none' : r.ref ? label(pages, r.ref) : r.text}${q ? ` (${q})` : ''}` }
  const effects = (schema.fields.quest ?? []).filter((f) => f.effect && (d[f.key] ?? []).length)
    .map((f) => `${f.label}: ${(d[f.key] as Row[]).map((r) => show(r, (f.extras ?? []).map(extraKey))).join(', ')}`)
  const leadsFrom = Object.values(pages).filter((p) => (p.data.leads_to ?? []).some((r: Row) => r.ref === id))
  const giver = giverField(schema)
  const by = giver && d[giver.key]?.[0]?.ref
  const start = leadsFrom.length ? `Follows ${leadsFrom.map((p) => label(pages, p.data.id)).join(', ')}` : by ? `${giver!.label}: ${label(pages, by)}` : 'Not decided'
  const rows = branches(q.body, schema.branches).filter((b) => b.condition)
  const facts = [['Path', path], ['Id', qid], ...(kind ? [['Kind', kind]] : []), ['Title', d.title], ['Summary', summary], ['Start', start]]
  const md = [`# Handoff: ${label(pages, id)}`, ...facts.map(([k, v]) => `- ${k}: ${v}`),
    `\n## Cast`, ...cast.map((c) => `- ${label(pages, c.ref)} (${c.role})`), `\n## Player decisions`, ...rows.map((b) => `- [ ] ${b.condition}: ${plain(b.outcome, pages)}`),
    `\n## No engine field yet`, ...effects.map((x) => `- ${x}`)].join('\n')
  return (
    <article className="page brief">
      <header className="page-head"><div className="kind">Handoff brief</div><h2>{label(pages, id)}</h2>
        <div className="status-row"><EngineBadge state={state} text={stateLabel(state, name, hits)} />{a.handoff_on && <span className="muted">Ready since {a.handoff_on}</span>}
          <button onClick={() => copy(md)}>Copy brief as Markdown</button>{hits.length === 1 && opensInEditor(e) && <button onClick={() => openInEngine(hits[0].path)}>Open in {name}</button>}<button onClick={() => peek(id)}>Lore page</button></div></header>
      <h4>Create in {name}</h4>
      <table className="brief-table"><tbody>
        {facts.map(([k, v]) => <tr key={k}><th>{k}</th><td>{v}</td><td>{k !== 'Start' && <Copy text={v} />}</td></tr>)}
      </tbody></table>
      <h4>Cast needed</h4>
      <table className="brief-table"><thead><tr><th>Who</th><th>Role</th><th>In engine</th></tr></thead><tbody>
        {cast.map((c, i) => {
          const s = characterState(pages[c.ref].data, engine, false), sugg = suggestCharacterId(pages[c.ref].data, engine)
          return <tr key={i} onClick={() => peek(c.ref)}><td>{label(pages, c.ref)}</td><td>{c.role}</td><td>{s === 'in' ? `yes, ${pages[c.ref].data.engine.id}` : s === 'unknown' ? '?' : sugg ? `not linked (${name} has “${sugg}”)` : 'no'}</td></tr>
        })}
      </tbody></table>
      <h4>Player decisions</h4>
      {rows.length ? <ul className="checklist">{rows.map((b, i) => <li key={i}><b>{b.condition}</b>: {plain(b.outcome, pages)}</li>)}</ul> : <p className="muted">No rows under {schema.branches}.</p>}
      <h4>No engine field yet</h4>
      {effects.length ? <ul>{effects.map((x) => <li key={x}>{x}</li>)}</ul> : <p className="muted">None.</p>}
      {section(q.body, 'Notes') && <><h4>Notes</h4><blockquote>{plain(section(q.body, 'Notes'), pages)}</blockquote></>}
      <h4>Changes since handoff</h4>
      {a.handoff_on ? (history.length ? <ul>{history.map((h) => <li key={h}>{h}</li>)}</ul> : <p className="muted">No recorded changes since {a.handoff_on}.</p>) : <p className="muted">Not marked Ready yet.</p>}
    </article>
  )
}
