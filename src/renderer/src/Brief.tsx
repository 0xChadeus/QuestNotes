// The handoff brief: what an engine designer builds in Animus for one quest. Read-only; QuestNotes never writes game files.
import { useEffect, useState } from 'react'
import { useStore, peek } from './store'
import { call } from './api'
import { Copy, EngineBadge, copy } from './ui'
import { label } from './derive'
import { openInAnimus } from './PageView'
import { characterState, questBadge, questState, suggestCharacterId, suggestQuestId } from '../../shared/engine'
import { branches, type Page } from '../../shared/page'
import type { Row } from '../../shared/schema'

const section = (body: string, name: string) => new RegExp(`^#{2,3} ${name}\\s*\\n+([\\s\\S]*?)(?=\\n#{1,3} |$)`, 'mi').exec(body)?.[1].trim() ?? ''
const plain = (md: string, pages: Record<string, Page>) => md.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, id, l) => l ?? label(pages, id)).replace(/^> /gm, '')

export function Brief({ id }: { id: string }) {
  const { pages, engine } = useStore()
  const [history, setHistory] = useState<string[]>([])
  const q = pages[id]
  const a = q?.data.animus ?? {}
  useEffect(() => { if (q && a.handoff_on) call('git:history', q.file, a.handoff_on).then(setHistory, () => setHistory([])) }, [q?.file, a.handoff_on])
  if (!q) return null
  const d = q.data
  const qid = a.quest_id ?? suggestQuestId(d.code ?? '', d.title)
  const kind = a.kind ?? pages[d.questline]?.data.kind ?? 'side'
  const path = `res://resources/quests/${kind}/${qid}.json`
  const state = questState(d, engine)
  const hits = engine?.quests[a.quest_id] ?? []
  const summary = d.synopsis || plain(section(q.body, 'Description').split('\n\n')[0] ?? '', pages)
  const castMap = new Map<string, string[]>()
  for (const [k, role] of [['issuer', 'issuer'], ['exposed', 'exposed']]) for (const r of (d[k] ?? []) as Row[])
    if (r.ref && pages[r.ref]?.data.type === 'character') castMap.set(r.ref, [...(castMap.get(r.ref) ?? []), r.condition ? `${role}, ${r.condition}` : role])
  const cast = [...castMap].map(([ref, roles]) => ({ ref, role: roles.join('; ') }))
  const lore = (k: string, name: string) => (d[k] ?? []).length ? `${name}: ${(d[k] as Row[]).map((r) => r.none ? 'none' : r.ref ? label(pages, r.ref) : r.text).join(', ')}` : ''
  const noHome = [lore('renown', 'Renown by district (Animus tracks map regions)'), lore('sanctioning', 'Sub-faction tracks'), lore('thresholds', 'Threshold contributions'), lore('leaks', 'Leak channels'), lore('anchor_pressure', 'Anchor pressure')].filter(Boolean)
  const leadsFrom = Object.values(pages).filter((p) => (p.data.leads_to ?? []).some((r: Row) => r.ref === id))
  const start = leadsFrom.length ? `Follows ${leadsFrom.map((p) => label(pages, p.data.id)).join(', ')} (quest_start from its end)` : d.issuer?.[0]?.ref ? `A conversation with the issuer, ${label(pages, d.issuer[0].ref)}` : 'Not decided'
  const rows = branches(q.body).filter((b) => b.condition)
  const md = [`# Handoff: ${label(pages, id)}`, `- Path: ${path}`, `- quest_id: ${qid} · kind: ${kind}`, `- Title: ${d.title}`, `- Summary: ${summary}`, `- Start: ${start}`,
    `\n## Cast`, ...cast.map((c) => `- ${label(pages, c.ref)} (${c.role})`), `\n## Player decisions`, plain(section(q.body, 'Disclosure'), pages), ...rows.map((b) => `- [ ] ${b.condition}: ${b.outcome}`),
    `\n## No engine field yet`, ...noHome.map((x) => `- ${x}`), `\n## Developer note`, plain(section(q.body, 'Developer note'), pages)].join('\n')
  return (
    <article className="page brief">
      <header className="page-head"><div className="kind">Handoff brief</div><h2>{label(pages, id)}</h2>
        <div className="status-row"><EngineBadge state={state} text={questBadge(state, hits)} />{a.handoff_on && <span className="muted">Ready since {a.handoff_on}</span>}
          <button onClick={() => copy(md)}>Copy brief as Markdown</button>{hits.length === 1 && <button onClick={() => openInAnimus(hits[0].path)}>Open in Animus</button>}<button onClick={() => peek(id)}>Lore page</button></div></header>
      <h4>Create in Animus</h4>
      <table className="brief-table"><tbody>
        {[['Path', path], ['quest_id', qid], ['kind', kind], ['Title', d.title], ['Summary', summary], ['Start', start]].map(([k, v]) =>
          <tr key={k}><th>{k}</th><td>{v}</td><td>{k !== 'Start' && <Copy text={v} />}</td></tr>)}
      </tbody></table>
      <h4>Cast needed</h4>
      <table className="brief-table"><thead><tr><th>Character</th><th>Role</th><th>In engine</th></tr></thead><tbody>
        {cast.map((c, i) => { const s = characterState(pages[c.ref].data, engine, false); return <tr key={i} onClick={() => peek(c.ref)}><td>{label(pages, c.ref)}</td><td>{c.role}</td><td>{s === 'in' ? `yes, ${pages[c.ref].data.animus.character_id}` : s === 'unknown' ? '?' : suggestCharacterId(pages[c.ref].data, engine) ? `not linked (Animus has “${suggestCharacterId(pages[c.ref].data, engine)}”)` : 'no'}</td></tr> })}
      </tbody></table>
      <h4>Player decisions</h4>
      <p>{plain(section(q.body, 'Disclosure'), pages) || <span className="muted">No Disclosure section.</span>}</p>
      <ul className="checklist">{rows.map((b, i) => <li key={i}><b>{b.condition}</b>: {plain(b.outcome, pages)}</li>)}</ul>
      <h4>No engine field yet</h4>
      <ul>{noHome.map((x) => <li key={x}>{x}</li>)}{d.time_pressure && <li>Time pressure: {d.time_pressure} (a stage deadline in Animus)</li>}</ul>
      <h4>Developer note</h4>
      <blockquote>{plain(section(q.body, 'Developer note'), pages) || '—'}</blockquote>
      <h4>Changes since handoff</h4>
      {a.handoff_on ? (history.length ? <ul>{history.map((h) => <li key={h}>{h}</li>)}</ul> : <p className="muted">No recorded changes since {a.handoff_on}.</p>) : <p className="muted">Not marked Ready yet.</p>}
    </article>
  )
}
