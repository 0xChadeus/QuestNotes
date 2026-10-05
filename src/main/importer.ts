// One-time import of the Broken Wings .docx design documents into pages. Prose field values become rows by finding
// known names in them; anything the importer cannot decide goes to the issues list for a person to settle.
import { unzipSync, strFromU8 } from 'fflate'
import { fileFor, HONORIFIC, newId, type Data, type Page } from '../shared/page'
import type { PageType, Row } from '../shared/schema'
import type { ImportResult } from '../shared/api'

type Block = { kind: 'p'; level: number; text: string } | { kind: 'table'; rows: string[][] }
interface Section { title: string; level: number; paras: string[]; tables: string[][][]; children: Section[] }

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const decode = (s: string) => s.replace(/&(amp|lt|gt|quot|apos);/g, (_, e) => ENT[e]).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
const runText = (x: string) => decode([...x.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:(tab|br)\/>/g)].map((m) => m[1] ?? (m[2] === 'tab' ? '\t' : '\n')).join(''))

function readDocx(buf: Uint8Array): Block[] {
  const xml = strFromU8(unzipSync(buf, { filter: (f) => f.name === 'word/document.xml' })['word/document.xml'])
  const out: Block[] = []
  for (const m of xml.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>|<w:p[ >][\s\S]*?<\/w:p>/g)) {
    if (m[0].startsWith('<w:tbl>')) {
      out.push({ kind: 'table', rows: [...m[0].matchAll(/<w:tr[ >][\s\S]*?<\/w:tr>/g)].map((r) =>
        [...r[0].matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)].map((c) => [...c[0].matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map((p) => runText(p[0]).trim()).filter(Boolean).join('\n'))) })
    } else {
      const text = runText(m[0]).trim()
      const style = /<w:pStyle w:val="([^"]+)"/.exec(m[0])?.[1] ?? ''
      if (text) out.push({ kind: 'p', level: +(/heading\s?(\d)/i.exec(style)?.[1] ?? 0), text })
    }
  }
  return out
}

function outline(blocks: Block[]): Section {
  const root: Section = { title: '', level: 0, paras: [], tables: [], children: [] }
  const stack = [root]
  for (const b of blocks) {
    if (b.kind === 'p' && b.level) {
      while (stack[stack.length - 1].level >= b.level) stack.pop()
      const s: Section = { title: b.text, level: b.level, paras: [], tables: [], children: [] }
      stack[stack.length - 1].children.push(s)
      stack.push(s)
    } else if (b.kind === 'p') { if (!/^END OF .*DOCUMENT$/.test(b.text)) stack[stack.length - 1].paras.push(b.text) }
    else stack[stack.length - 1].tables.push(b.rows)
  }
  return root
}
const all = (s: Section): Section[] => [s, ...s.children.flatMap(all)]
const find = (s: Section, re: RegExp) => all(s).find((x) => re.test(x.title))

const SMALL = new Set(['a', 'an', 'and', 'the', 'of', 'in', 'on', 'to', 'for', 'at', 'by', 'or'])
const titleCase = (s: string) => s !== s.toUpperCase() ? s : s.toLowerCase().replace(/[\p{L}’']+/gu, (w, i) => (i && SMALL.has(w) ? w : w[0].toUpperCase() + w.slice(1)))
const roman = (r: string) => ({ I: 1, II: 2, III: 3, IV: 4 })[r as 'I'] ?? 0
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const cell = (s: string) => s.replace(/\n+/g, ' ').replace(/\|/g, '\\|')
const md = (paras: string[]) => paras.join('\n\n')
/** Splits on commas outside parentheses. */
const splitTop = (s: string) => { const out: string[] = []; let d = 0, cur = ''; for (const ch of s) { if (ch === '(') d++; if (ch === ')') d--; if (ch === ',' && !d) { out.push(cur); cur = '' } else cur += ch } return [...out, cur].map((x) => x.trim()).filter(Boolean) }
const sentences = (s: string) => s.split(/(?<=[.!?])\s+(?=[A-Z])/).map((x) => x.trim().replace(/\.$/, '')).filter(Boolean)

export function importDocs(files: { name: string; data: Uint8Array }[], existing: Page[]): ImportResult {
  const docs = Object.fromEntries(files.map((f) => [f.name.toLowerCase(), outline(readDocx(f.data))]))
  const doc = (key: string, not = '^$') => Object.entries(docs).find(([n]) => n.includes(key) && !new RegExp(not).test(n))?.[1]
  const pages: Page[] = []
  const issues: string[] = []
  const taken = new Set(existing.map((p) => p.data.id))
  const names: { name: string; id: string; type: PageType }[] = []
  const epithets = new Map<string, string>()

  const make = (type: PageType, title: string, data: Partial<Data> = {}, body = '', id?: string): Data => {
    const pid = id ?? newId(type, title, (x) => taken.has(x))
    if (taken.has(pid)) return existing.find((p) => p.data.id === pid)?.data ?? pages.find((p) => p.data.id === pid)!.data
    taken.add(pid)
    const d = { id: pid, type, title, ...data } as Data
    pages.push({ file: fileFor(type, pid), data: d, body })
    names.push({ name: title, id: pid, type }, ...((d.aliases as string[]) ?? []).map((a) => ({ name: a, id: pid, type })))
    return d
  }
  const byTitle = (type: PageType, title: string) => pages.find((p) => p.data.type === type && p.data.title.toLowerCase() === title.toLowerCase())?.data
  const lookup = (text: string, types: PageType[]) => {
    let best: { id: string; name: string; at: number } | undefined
    for (const n of names) {
      if (!types.includes(n.type)) continue
      const at = text.search(new RegExp(`\\b${esc(n.name)}(?:['’]s)?\\b`, 'i'))
      if (at >= 0 && (!best || at < best.at || (at === best.at && n.name.length > best.name.length))) best = { id: n.id, name: n.name, at }
    }
    return best
  }

  // Purgatory: districts, factions, mysteries.
  const world = doc('purgatory', 'faces')
  const body = (s: Section): string => md([...s.paras, ...s.children.map((c) => `${'#'.repeat(Math.min(c.level, 3))} ${titleCase(c.title)}\n\n${body(c)}`)])
  const worldDistricts = world ? find(world, /^The Districts$/i)?.children ?? [] : []
  for (const s of worldDistricts) make('district', s.title, { aliases: s.title.startsWith('The ') ? [s.title.slice(4)] : undefined }, body(s))
  const factionAliases = (t: string) => { const b = t.replace(/^The /, ''); return [...new Set([b, b.split(' of ')[0]])].filter((a) => a !== t) }
  for (const s of (world && find(world, /^PART IV/i)?.children) ?? []) {
    if (/^Minor Factions$/i.test(s.title)) for (const c of s.children.filter((c) => !c.title.includes(','))) make('faction', c.title, { aliases: factionAliases(c.title) }, body(c))
    else make('faction', s.title, { aliases: factionAliases(s.title) }, body(s))
  }
  for (const s of (world && find(world, /^PART VII/i)?.children) ?? []) make('mystery', s.title, {}, body(s))

  // Characters: the principals, then the side characters grouped by district.
  const hooks: { text: string; issuer?: string }[] = []
  for (const s of doc('characters')?.children ?? []) make('character', titleCase(s.title), { tier: 'principal' }, body(s))
  for (const g of doc('faces')?.children.filter((g) => g.level === 1) ?? []) {
    const group = titleCase(g.title)
    const isDistrict = !/wanderers|dangerous/i.test(group)
    let district = isDistrict ? (byTitle('district', group) ?? byTitle('district', group.replace(/^The /, ''))) : undefined
    if (isDistrict && !district) {
      district = make('district', group)
      if (world) issues.push(`${group} is a district in Faces of Purgatory, but Purgatory lists no such district.`)
    }
    for (const c of g.children) {
      const [name, ...rest] = c.title.split(',')
      const full = name.trim().replace(/[“”"]/g, '')
      const plain = full.replace(HONORIFIC, '')
      const prose = c.paras.filter((p) => !p.startsWith('[QUEST HOOK]'))
      const ch = make('character', full, { aliases: plain !== full ? [plain] : undefined, tier: 'side', district: district?.id, group: isDistrict ? undefined : group }, body({ ...c, paras: prose }))
      if (rest.length) epithets.set(rest.join(',').trim().replace(/^the /i, '').replace(/[“”"]/g, '').toLowerCase(), full)
      for (const p of c.paras.filter((p) => p.startsWith('[QUEST HOOK]'))) hooks.push({ text: p.replace('[QUEST HOOK]', '').trim(), issuer: ch.id })
    }
  }
  // First names stand for a character when no other character shares them.
  const firsts = new Map<string, string[]>()
  for (const p of pages.filter((p) => p.data.type === 'character')) {
    const f = p.data.title.replace(HONORIFIC, '').split(' ')[0]
    if (f !== p.data.title) firsts.set(f, [...(firsts.get(f) ?? []), p.data.id])
  }
  for (const [f, ids] of firsts) if (ids.length === 1) names.push({ name: f, id: ids[0], type: 'character' })
  for (const p of pages.filter((p) => p.data.tier === 'principal')) {
    const first = p.data.title.split(' ')[0]
    const freq = new Map<string, number>()
    for (const w of p.body.match(/\b[A-Z][a-z]{1,5}\b/g) ?? []) if (w !== first && first.toLowerCase().includes(w.toLowerCase())) freq.set(w, (freq.get(w) ?? 0) + 1)
    for (const [w, n] of freq) if (n >= 5) { p.data.aliases = [...(p.data.aliases ?? []), w]; names.push({ name: w, id: p.data.id, type: 'character' }) }
  }

  // Narrative: acts and quests named in the worked examples.
  const acts: Data[] = []
  const actOf = (n: number) => acts[n - 1] ?? (acts[n - 1] = make('act', `Act ${['I', 'II', 'III', 'IV'][n - 1]}`, { order: n, subsections: [] }, '', `act_${n}`))
  const narrative = doc('narrative')
  for (const p of (narrative && find(narrative, /THREE-ACT STRUCTURE/i)?.paras) ?? []) {
    const m = /^Act (I{1,3}|IV) — ([^.]+)\.\s*(.*)$/.exec(p)
    if (m) acts[roman(m[1]) - 1] = make('act', m[2], { order: roman(m[1]), subsections: [] }, m[3], `act_${roman(m[1])}`)
  }
  const main = make('questline', 'Main', { kind: 'main', order: 1 }, '', 'ql_main')

  // Quest Index: thresholds, leak channels, then the worked quests.
  const qdoc = doc('quests')
  const schemaLine = qdoc && all(qdoc).flatMap((s) => s.paras).find((p) => p.startsWith('Threshold contributions.'))
  for (const t of splitTop(/—\s*(.*?)(?:,?\s*and so on|\.)/.exec(schemaLine ?? '')?.[1] ?? '')) make('threshold', t.replace(/^the /i, ''))
  const leakSec = qdoc && find(qdoc, /^LEAK CHANNELS$/i)
  if (leakSec) {
    make('leak', 'Direct witness', {}, leakSec.paras.find((p) => /default channel/i.test(p)) ?? '')
    const from = leakSec.paras.findIndex((p) => /require setup/i.test(p))
    for (const p of leakSec.paras.slice(from + 1)) {
      const m = /^(.+?) (?:carry|carries|is) /.exec(p)
      if (!m || /tracked per quest/i.test(p)) continue
      const owner = lookup(m[1], ['character'])
      make('leak', m[1], { owner: owner?.id }, p)
    }
  }
  const stubs = new Map<string, string>()
  const stub = (name: string) => {
    if (!stubs.has(name)) {
      stubs.set(name, make('character', name, { tier: 'named only' }).id)
      const ep = epithets.get(name.toLowerCase())
      issues.push(ep ? `“${name}” appears in quests without a profile, and “the ${name}” is the epithet of ${ep}. Same person?` : `${name} appears in quests but has no profile.`)
    }
    return stubs.get(name)!
  }
  /** Prose field value → rows. Names found become refs; the rest of each item becomes its note. */
  const rows = (text: string | undefined, types: PageType[], opts: { commas?: boolean; people?: boolean; extra?: (r: Row, item: string) => void } = {}): Row[] => {
    if (!text) return []
    const sents = sentences(text)
    if (/^none\b/i.test(sents[0] ?? '')) return [{ none: true, note: [sents[0].replace(/^none\b\.?\s*/i, ''), ...sents.slice(1)].filter(Boolean).join('. ') || undefined }]
    const out: Row[] = []
    for (const item of opts.commas ? sents.flatMap(splitTop) : sents) {
      const found = lookup(item, types)
      const hit = found && /^(the\s+)?$/i.test(item.slice(0, found.at)) ? found : undefined // a name further in is mentioned, not the subject
      const person = !hit && opts.people && /^([A-Z][a-z]+(?: [A-Z][a-z]+)?)(?=\s*\(|$)/.exec(item)?.[1]
      if (hit || (person && !/^(The|Other|Multiple)\b/.test(person))) {
        const name = hit?.name ?? (person as string)
        const note = item.replace(new RegExp(`\\b${esc(name)}(?:['’]s)?\\b`, 'i'), '').trim().replace(/^\((.*)\)$/s, '$1').replace(/^[\s,.:—-]+|[\s,.]+$/g, '')
        const r: Row = { ref: hit?.id ?? stub(name as string), note: note || undefined }
        opts.extra?.(r, item)
        out.push(r)
      } else if (out.length && !opts.commas) out[out.length - 1].note = [out[out.length - 1].note, item].filter(Boolean).join('. ')
      else out.push({ text: item })
    }
    return out
  }
  const exposedExtra = (r: Row) => {
    const w = /^(heavy|light|minor|major)\b\s*[—-]?\s*/i.exec(r.note ?? '')
    if (w) { r.weight = w[1].toLowerCase(); r.note = r.note!.slice(w[0].length) || undefined }
    const c = /^conditional[\s,—-]*(.*)$/i.exec(r.note ?? '')
    if (c) { r.condition = c[1] || 'conditional'; delete r.note }
  }
  for (const q of qdoc?.children.filter((s) => /^MQ\d+ — /.test(s.title)) ?? []) {
    const [code, name] = q.title.split(' — ')
    const f = Object.fromEntries(q.paras.map((p) => /^([^:.]{3,40}): (.*)$/.exec(p)).filter(Boolean).map((m) => [m![1], m![2]]))
    for (const s of /^none/i.test(f['Threshold contributions'] ?? '') ? [] : sentences(f['Threshold contributions'] ?? '')) {
      const t = s.split(' (')[0]
      if (!/^none/i.test(s) && t.split(' ').length <= 5 && !lookup(t, ['threshold'])) make('threshold', t)
    }
    const act = /^(I{1,3}|IV)(?:\s*—\s*(.+))?/.exec(f.Act ?? '')
    if (act?.[2]) { const a = actOf(roman(act[1])); if (!a.subsections.includes(act[2])) a.subsections.push(act[2]) }
    const sec = (re: RegExp) => q.children.find((c) => re.test(c.title))
    const vectors = sec(/execution vectors/i)?.paras.map((p) => { const m = /^(\w+)\.\s+(.*)$/s.exec(p); return m ? `### ${m[1]}\n\n${m[2]}` : p }) ?? []
    const tables = q.children.flatMap((c) => c.tables)
    const branch = tables.find((t) => /branch condition/i.test(t[0]?.[0] ?? ''))
    const note = tables.find((t) => /^DEVELOPER NOTE:/i.test(t[0]?.[0] ?? ''))?.[0][0].replace(/^DEVELOPER NOTE:\s*/i, '')
    const bodyText = [
      `## Description\n\n${md(sec(/description/i)?.paras ?? [])}`, `## Execution vectors\n\n${md(vectors)}`,
      branch && `## Branching surfaces\n\n| Branch condition | Outcome | Pays off in |\n| --- | --- | --- |\n${branch.slice(1).map((r) => `| ${cell(r[0] ?? '')} | ${cell(r[1] ?? '')} |  |`).join('\n')}`,
      note && `## Developer note\n\n> ${note}`,
    ].filter(Boolean).join('\n\n')
    make('quest', titleCase(name), {
      code, status: 'draft', act: act ? actOf(roman(act[1])).id : undefined, subsection: act?.[2], questline: main.id,
      issuer: rows(f.Issuer, ['character'], { people: true }),
      sanctioning: rows(f['Sanctioning sub-factions'], ['faction']),
      exposed: rows(f['Exposed characters'], ['character', 'faction'], { commas: true, people: true, extra: exposedExtra }),
      renown: rows(f['Renown impact'], ['district']),
      anchor_pressure: rows(f['Anchor pressure'], ['character'], { extra: (r, i) => { const a = /\b(Material|Identity|Bond|Fear|Belief)\b/.exec(i); if (a) r.anchor = a[1].toLowerCase() } }),
      morale: rows(f['Morale impact'], ['character']),
      thresholds: rows(f['Threshold contributions'], ['threshold'], { extra: (r, i) => { const v = /(\w+) vector/.exec(i); if (v) r.vector = v[1] } }),
      leaks: rows(f['Leak channels'], ['leak', 'character'], { extra: (r) => { if (r.note) { r.condition = r.note.replace(/^(is|are)\s+/, ''); delete r.note } } }),
      time_pressure: f['Time pressure'],
    }, bodyText, `q_${code.toLowerCase()}`)
  }
  for (const s of (narrative && all(narrative).filter((x) => /^WORKED EXAMPLE/i.test(x.title))) ?? []) {
    const code = /\b(MQ\d+)\b/.exec(s.paras.join(' '))?.[1]
    if (!code || taken.has(`q_${code.toLowerCase()}`)) continue
    const n = /Act (I{1,3}|IV)\b/.exec(s.paras.join(' '))?.[1]
    make('quest', titleCase(s.title.replace(/^WORKED EXAMPLE:\s*/i, '')), { code, status: 'idea', act: n ? actOf(roman(n)).id : undefined, questline: main.id },
      `## Description\n\n${md(s.paras)}`, `q_${code.toLowerCase()}`)
  }

  // Hooks: quest-shaped ones become Idea quests in the tray; "not a quest-giver" ones describe a character's role.
  for (const h of hooks) {
    const ch = pages.find((p) => p.data.id === h.issuer)!
    let first = sentences(h.text)[0] ?? h.text
    if (/not a quest|\bvendor\b|can be hired|\bprovides?\b|is a source/i.test(first)) { ch.data.role_in_play = [ch.data.role_in_play, h.text].filter(Boolean).join('\n\n'); continue }
    const cut = first.slice(16).search(/[:;,—]/)
    if (cut >= 0) first = first.slice(0, cut + 16)
    const title = first.length > 60 ? first.slice(0, 60).replace(/\s+\S*$/, '') + '…' : first
    make('quest', title, { status: 'idea', issuer: [{ ref: h.issuer }] }, `## Description\n\n${h.text}`)
  }

  const counts: Record<string, number> = {}
  for (const p of pages) counts[p.data.type] = (counts[p.data.type] ?? 0) + 1
  return { pages, issues, counts }
}
