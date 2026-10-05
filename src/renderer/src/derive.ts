// Everything computed from the pages: backlinks, payoffs, cast roles, completeness, issues. Nothing here is stored.
import { branches, refsOf, type Data, type Page } from '../../shared/page'
import { castFields, castKind, giverField, kindOf, type Row, type Schema } from '../../shared/schema'

export type Pages = Record<string, Page>

export const byType = (pages: Pages, t: string) =>
  Object.values(pages).filter((p) => p.data.type === t).sort((a, b) => (a.data.order ?? 99) - (b.data.order ?? 99) || sortKey(a.data).localeCompare(sortKey(b.data)))
const sortKey = (d: Data) => `${d.code ?? ''} ${d.title}`

export function label(pages: Pages, id?: string) {
  const d = id ? pages[id]?.data : undefined
  if (!d) return id ?? ''
  return d.type === 'act' ? `Act ${roman(d.order ?? 0)} · ${d.title}` : d.code ? `${d.code} ${d.title}` : d.title || 'Untitled'
}
export const roman = (n: number) => ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][n] ?? String(n)
export const kindLabel = (s: Schema, type: string) => kindOf(s, type)?.label ?? type

interface Payoff { from: string; condition: string; outcome: string; line: number }

export function derive(s: Schema, pages: Pages) {
  const backlinks = new Map<string, Set<string>>()
  const incoming = new Map<string, Payoff[]>()
  for (const p of Object.values(pages)) {
    for (const r of refsOf(s, p)) (backlinks.get(r) ?? backlinks.set(r, new Set()).get(r)!).add(p.data.id)
    if (p.data.type === 'quest') for (const b of branches(p.body, s.branches)) for (const t of b.targets)
      (incoming.get(t) ?? incoming.set(t, []).get(t)!).push({ from: p.data.id, condition: b.condition, outcome: b.outcome, line: b.line })
  }
  return { backlinks, incoming }
}

/** The cast matrix glyphs for one character in one quest; "?" when every mention has a condition. */
export function roles(s: Schema, q: Data, ch: string) {
  return castFields(s).flatMap((f) => {
    const rows = ((q[f.key] ?? []) as Row[]).filter((r) => r.ref === ch)
    return rows.length ? [rows.every((r) => r.condition) ? `${f.glyph}?` : f.glyph] : []
  })
}

/** Title, required fields and sections; the branch section counts once it has a filled row. */
export function completeness(s: Schema, p: Page) {
  const filled = (v: unknown) => (Array.isArray(v) ? v.length > 0 : !!v)
  const section = (name: string) => name === s.branches ? branches(p.body, s.branches).some((b) => b.condition) : hasText(p.body, name)
  const checks: [string, boolean][] = [
    ['Title', !!p.data.title], ...(s.fields.quest ?? []).filter((f) => f.required).map((f) => [f.label, filled(p.data[f.key])] as [string, boolean]),
    ...s.required.map((n) => [n === s.branches ? `A row under ${n}` : n, section(n)] as [string, boolean]),
  ]
  return { done: checks.filter((c) => c[1]).length, total: checks.length, missing: checks.filter((c) => !c[1]).map((c) => c[0]) }
}

/** Whether the section under a heading has any text, its sub-sections included. */
function hasText(body: string, heading: string) {
  const lines = body.split('\n')
  const at = lines.findIndex((l) => /^#{1,6}\s/.test(l) && l.replace(/^#+\s+/, '').trim().toLowerCase() === heading.toLowerCase())
  if (at < 0) return false
  const level = /^#+/.exec(lines[at])![0].length
  for (const l of lines.slice(at + 1)) {
    const h = /^(#+)\s/.exec(l)
    if (h && h[1].length <= level) return false
    if (!h && l.trim()) return true
  }
  return false
}

interface Issue { kind: string; text: string; id?: string }
export function issues(s: Schema, pages: Pages, imported: string[] = []): Issue[] {
  const out: Issue[] = imported.map((text) => ({ kind: 'Import', text }))
  const ids = new Set(Object.keys(pages))
  const quests = byType(pages, 'quest')
  const used = new Set(quests.flatMap((q) => refsOf(s, q)))
  const qids = new Map<string, string[]>()
  const giver = giverField(s)
  for (const p of Object.values(pages)) for (const r of refsOf(s, p)) if (!ids.has(r)) out.push({ kind: 'Broken link', text: `${label(pages, p.data.id)} links to “${r}”, which does not exist`, id: p.data.id })
  for (const q of quests) {
    if (q.data.status === 'cut') continue
    if (q.data.engine?.id) qids.set(q.data.engine.id, [...(qids.get(q.data.engine.id) ?? []), q.data.id])
    if (giver && q.data.status !== 'idea' && !(q.data[giver.key] ?? []).length) out.push({ kind: `No ${giver.label.toLowerCase()}`, text: `${label(pages, q.data.id)} has no ${giver.label.toLowerCase()}`, id: q.data.id })
    for (const b of branches(q.body, s.branches)) if (/unplaced/i.test(b.payoff)) out.push({ kind: 'Unplaced payoff', text: `${label(pages, q.data.id)}: “${b.condition}” pays off somewhere not yet placed`, id: q.data.id })
    if (q.data.status === 'ready') { const c = completeness(s, q); if (c.missing.length) out.push({ kind: 'Ready but incomplete', text: `${label(pages, q.data.id)} is missing ${c.missing.join(', ')}`, id: q.data.id }) }
  }
  const engine = s.engine?.name ?? 'engine'
  for (const [qid, list] of qids) if (list.length > 1) out.push({ kind: `Duplicate ${engine} id`, text: `${list.map((i) => label(pages, i)).join(' and ')} share the ${engine} id ${qid}`, id: list[0] })
  const cast = castKind(s)
  const unused = byType(pages, cast).filter((c) => !used.has(c.data.id))
  if (unused.length) out.push({ kind: `${kindOf(s, cast)?.plural ?? cast} in no quest`, text: `${unused.length} ${(kindOf(s, cast)?.plural ?? cast).toLowerCase()} appear in no quest yet` })
  return out
}
