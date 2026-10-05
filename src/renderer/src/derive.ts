// Everything computed from the pages: backlinks, payoffs, cast roles, completeness, issues. Nothing here is stored.
import { branches, refsOf, type Data, type Page } from '../../shared/page'
import { REQUIRED_QUEST_FIELDS, type PageType, type Row } from '../../shared/schema'

export type Pages = Record<string, Page>

export const byType = (pages: Pages, t: PageType) =>
  Object.values(pages).filter((p) => p.data.type === t).sort((a, b) => (a.data.order ?? 99) - (b.data.order ?? 99) || sortKey(a.data).localeCompare(sortKey(b.data)))
const sortKey = (d: Data) => `${d.code ?? ''} ${d.title}`

export function label(pages: Pages, id?: string) {
  const d = id ? pages[id]?.data : undefined
  if (!d) return id ?? ''
  return d.type === 'act' ? `Act ${roman(d.order ?? 0)} · ${d.title}` : d.code ? `${d.code} ${d.title}` : d.title || 'Untitled'
}
export const roman = (n: number) => ['', 'I', 'II', 'III', 'IV', 'V', 'VI'][n] ?? String(n)

interface Payoff { from: string; condition: string; outcome: string; line: number }

export function derive(pages: Pages) {
  const backlinks = new Map<string, Set<string>>()
  const incoming = new Map<string, Payoff[]>()
  for (const p of Object.values(pages)) {
    for (const r of refsOf(p)) (backlinks.get(r) ?? backlinks.set(r, new Set()).get(r)!).add(p.data.id)
    if (p.data.type === 'quest') for (const b of branches(p.body)) for (const t of b.targets)
      (incoming.get(t) ?? incoming.set(t, []).get(t)!).push({ from: p.data.id, condition: b.condition, outcome: b.outcome, line: b.line })
  }
  return { backlinks, incoming }
}

/** The cast matrix glyphs for one character in one quest. */
export function roles(q: Data, ch: string) {
  const has = (k: string) => ((q[k] ?? []) as Row[]).filter((r) => r.ref === ch)
  const out: string[] = []
  if (has('issuer').length) out.push('I')
  const e = has('exposed')
  if (e.length) out.push(e.every((r) => r.condition) ? 'E?' : 'E')
  if (has('anchor_pressure').length) out.push('A')
  if (has('morale').length) out.push('M')
  return out
}

/** Quest Index completeness: required fields, a description, three vectors, one branching row. */
export function completeness(p: Page) {
  const filled = (k: string) => k === 'act' ? !!p.data.act : ((p.data[k] ?? []) as Row[]).length > 0
  const section = (name: string) => new RegExp(`^#{2,3} ${name}\\s*\\n+(?!#)\\S`, 'mi').test(p.body)
  const checks: [string, boolean][] = [
    ['Title', !!p.data.title], ...REQUIRED_QUEST_FIELDS.map((k) => [k.replace('_', ' '), filled(k)] as [string, boolean]),
    ['Description', section('Description')], ['Method', section('Method')], ['Collateral', section('Collateral')],
    ['Disclosure', section('Disclosure')], ['A branching row', branches(p.body).some((b) => b.condition)],
  ]
  return { done: checks.filter((c) => c[1]).length, total: checks.length, missing: checks.filter((c) => !c[1]).map((c) => c[0]) }
}

interface Issue { kind: string; text: string; id?: string }
export function issues(pages: Pages, imported: string[] = []): Issue[] {
  const out: Issue[] = imported.map((text) => ({ kind: 'Import', text }))
  const ids = new Set(Object.keys(pages))
  const quests = byType(pages, 'quest')
  const used = new Set(quests.flatMap((q) => refsOf(q)))
  const qids = new Map<string, string[]>()
  for (const p of Object.values(pages)) for (const r of refsOf(p)) if (!ids.has(r)) out.push({ kind: 'Broken link', text: `${label(pages, p.data.id)} links to “${r}”, which does not exist`, id: p.data.id })
  for (const q of quests) {
    if (q.data.status === 'cut') continue
    if (q.data.animus?.quest_id) qids.set(q.data.animus.quest_id, [...(qids.get(q.data.animus.quest_id) ?? []), q.data.id])
    if (q.data.status !== 'idea' && !(q.data.issuer ?? []).length) out.push({ kind: 'No issuer', text: `${label(pages, q.data.id)} has no issuer`, id: q.data.id })
    for (const b of branches(q.body)) if (/unplaced/i.test(b.payoff)) out.push({ kind: 'Unplaced payoff', text: `${label(pages, q.data.id)}: “${b.condition}” pays off somewhere not yet placed`, id: q.data.id })
    if (q.data.status === 'ready') { const c = completeness(q); if (c.missing.length) out.push({ kind: 'Ready but incomplete', text: `${label(pages, q.data.id)} is missing ${c.missing.join(', ')}`, id: q.data.id }) }
  }
  for (const [qid, list] of qids) if (list.length > 1) out.push({ kind: 'Duplicate Animus id', text: `${list.map((i) => label(pages, i)).join(' and ')} share the Animus id ${qid}`, id: list[0] })
  for (const c of byType(pages, 'character')) if (c.data.tier === 'named only') out.push({ kind: 'No profile', text: `${c.data.title} is named but has no profile`, id: c.data.id })
  const unused = byType(pages, 'character').filter((c) => !used.has(c.data.id))
  if (unused.length) out.push({ kind: 'Characters in no quest', text: `${unused.length} characters appear in no quest yet` })
  return out
}
