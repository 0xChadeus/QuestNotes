// Import of design documents (.docx). Import jobs, kept in the project's questnotes.yaml, say which headings or paragraphs
// become pages of which kind. "Label: value" lines fill fields by label, and names found in field values become links.
// Whatever the importer cannot decide goes to the issues list for a person to settle.
import { unzipSync, strFromU8 } from 'fflate'
import { fileFor, HONORIFIC, newId, type Data, type Page } from '../shared/page'
import { extraKey, kindOf, type Field, type ImportJob, type Row, type Schema } from '../shared/schema'
import type { ImportFile, ImportResult } from '../shared/api'

type Block = { kind: 'p'; level: number; text: string } | { kind: 'table'; rows: string[][] }
interface Section { title: string; level: number; paras: string[]; children: Section[]; parent?: Section; order: (string | string[][])[] }

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
      if (text) out.push({ kind: 'p', level: +(/<w:pStyle w:val="heading\s?(\d)"/i.exec(m[0])?.[1] ?? 0), text })
    }
  }
  return out
}

function outline(blocks: Block[]): Section {
  const root: Section = { title: '', level: 0, paras: [], children: [], order: [] }
  const stack = [root]
  for (const b of blocks) {
    if (b.kind === 'p' && b.level) {
      while (stack[stack.length - 1].level >= b.level) stack.pop()
      const s: Section = { title: b.text, level: b.level, paras: [], children: [], order: [], parent: stack[stack.length - 1] }
      s.parent!.children.push(s)
      stack.push(s)
    } else if (b.kind === 'p') { stack[stack.length - 1].paras.push(b.text); stack[stack.length - 1].order.push(b.text) }
    else stack[stack.length - 1].order.push(b.rows)
  }
  return root
}
const all = (s: Section): Section[] => [s, ...s.children.flatMap(all)]

const SMALL = new Set(['a', 'an', 'and', 'the', 'of', 'in', 'on', 'to', 'for', 'at', 'by', 'or'])
const titleCase = (s: string) => s !== s.toUpperCase() ? s : s.toLowerCase().replace(/[\p{L}’']+/gu, (w, i) => (i && SMALL.has(w) ? w : w[0].toUpperCase() + w.slice(1)))
const ROMAN: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8 }
const number = (r: string) => ROMAN[r.toUpperCase()] ?? (+r || 0)
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const rx = (s: string) => { try { return new RegExp(s, 'i') } catch { return new RegExp(esc(s), 'i') } }
const cell = (s: string) => s.replace(/\n+/g, ' ').replace(/\|/g, '\\|')
const CODE = /^([A-Z]{1,4}\d+)\s*[—–-]\s*(.+)$/
/** Splits on commas outside parentheses. */
const splitTop = (s: string) => { const out: string[] = []; let d = 0, cur = ''; for (const ch of s) { if (ch === '(') d++; if (ch === ')') d--; if (ch === ',' && !d) { out.push(cur); cur = '' } else cur += ch } return [...out, cur].map((x) => x.trim()).filter(Boolean) }
const sentences = (s: string) => s.split(/(?<=[.!?])\s+(?=[A-Z])/).map((x) => x.trim().replace(/\.$/, '')).filter(Boolean)
const isBranchTable = (t: string[][]) => t.length > 1 && t[0].length >= 2 && /condition|choice|branch|option/i.test(t[0][0])

/** A heading outline of each document, to help write import jobs. */
export function describe(files: { name: string; data: Uint8Array }[]): ImportFile[] {
  return files.map((f) => {
    const heads = all(outline(readDocx(f.data))).filter((s) => s.level)
    const lines = heads.slice(0, 80).map((s) => `${'  '.repeat(s.level - 1)}H${s.level} ${s.title}${s.paras.length ? `  (${s.paras.length} ¶)` : ''}`)
    return { name: f.name, outline: [...lines, ...(heads.length > 80 ? [`… ${heads.length - 80} more headings`] : [])].join('\n') }
  })
}

/** Jobs guessed from the documents: "CODE — Title" headings become quests; a document named after a kind gives that kind. */
export function suggest(files: { name: string; data: Uint8Array }[], s: Schema): ImportJob[] {
  return files.flatMap((f) => {
    const heads = all(outline(readDocx(f.data))).filter((x) => x.level)
    const coded = heads.find((h) => CODE.test(h.title))
    if (coded) return [{ file: esc(f.name), kind: 'quest', level: coded.level, match: CODE.source }]
    const kind = s.kinds.find((k) => k.id !== 'quest' && new RegExp(`(?<![a-z])(${esc(k.plural)}|${esc(k.label)})(?![a-z])`, 'i').test(f.name))
    const level = [1, 2, 3].find((l) => heads.some((h) => h.level === l))
    return kind && level ? [{ file: esc(f.name), kind: kind.id, level }] : []
  })
}

export function importDocs(files: { name: string; data: Uint8Array }[], jobs: ImportJob[], s: Schema, existing: Page[]): ImportResult {
  const docs = files.map((f) => ({ name: f.name, root: outline(readDocx(f.data)) }))
  const pages: Page[] = []
  const issues: string[] = []
  const taken = new Set(existing.map((p) => p.data.id))
  const names: { name: string; id: string; type: string }[] = []
  const subtitles = new Map<string, string>()
  const known: Data[] = []
  /** A page's names for finding it in prose: title, aliases, and the title without a leading "The". */
  const add = (d: Data) => {
    known.push(d)
    for (const name of new Set([d.title, d.title.replace(/^the\s+/i, ''), ...((d.aliases as string[]) ?? [])])) names.push({ name, id: d.id, type: d.type })
  }
  existing.forEach((p) => add(p.data))
  const giver = s.fields.quest.find((f) => f.giver)
  const people = giver?.to ?? []

  const make = (type: string, title: string, data: Partial<Data> = {}, body = '', id?: string): Data => {
    const pid = id ?? newId(s, type, title, (x) => taken.has(x))
    const found = known.find((d) => d.id === pid)
    if (found) return found
    taken.add(pid)
    const d = { id: pid, type, title, ...data } as Data
    pages.push({ file: fileFor(s, type, pid), data: d, body })
    add(d)
    return d
  }
  const byTitle = (types: string[], title: string) => known.find((d) => types.includes(d.type) && [d.title, ...(d.aliases ?? [])].some((n: string) => n.toLowerCase() === title.toLowerCase()))
  const lookup = (text: string, types: string[]) => {
    let best: { id: string; name: string; at: number } | undefined
    for (const n of names) {
      if (!types.includes(n.type)) continue
      const at = text.search(new RegExp(`\\b${esc(n.name)}(?:['’]s)?\\b`, 'i'))
      if (at >= 0 && (!best || at < best.at || (at === best.at && n.name.length > best.name.length))) best = { ...n, at }
    }
    return best
  }
  const kindName = (k: string) => kindOf(s, k)?.label.toLowerCase() ?? k
  /** A page of one of these kinds named `title`, created (and reported) when none exists. */
  const resolve = (types: string[], title: string, why = '') => byTitle(types, title) ?? (why && issues.push(why), make(types[0], title))
  const created = (kind: string, name: string) => {
    const d = byTitle([kind], name)
    if (d) return d.id
    const sub = subtitles.get(name.toLowerCase())
    issues.push(sub ? `“${name}” is named in a quest without a page of its own, and “the ${name}” describes ${sub}. Same ${kindName(kind)}?` : `“${name}” is named in a quest; a ${kindName(kind)} page was created for it.`)
    return make(kind, name).id
  }

  /** Prose field value → rows. A name at the start of an item becomes a ref; the rest of the item becomes its qualifiers. */
  const rowsFrom = (text: string, f: Field, job: ImportJob): Row[] => {
    const sents = sentences(text)
    if (/^none\b/i.test(sents[0] ?? '')) return [{ none: true, note: [sents[0].replace(/^none\b\.?\s*/i, ''), ...sents.slice(1)].filter(Boolean).join('. ') || undefined }]
    const commas = f.to!.some((t) => people.includes(t)) && sents.length === 1
    const keys = (f.extras ?? []).map(extraKey)
    const out: Row[] = []
    for (const item of commas ? sents.flatMap(splitTop) : sents) {
      const found = lookup(item, f.to!)
      const hit = found && /^(the\s+)?$/i.test(item.slice(0, found.at)) ? found : undefined
      const lead = /^([A-Z][\w’'-]*(?: [A-Z][\w’'-]*){0,4})(?=\s*\(|\s*$|\s+[—–-])/.exec(item)?.[1]
      const kind = f.to!.find((t) => job.create?.includes(t))
      if (hit || (lead && kind && (commas || !out.length || !people.includes(kind)) && !/^(The|Other|Multiple|None)\b/.test(lead))) {
        const name = hit?.name ?? lead!
        let note = item.replace(new RegExp(`^(the\\s+)?${esc(name)}(?:['’]s)?`, 'i'), '').trim().replace(/^\((.*)\)$/s, '$1').replace(/^[\s,.:—-]+|[\s,.]+$/g, '')
        const r: Row = { ref: hit?.id ?? created(kind!, name) }
        for (const x of f.extras ?? []) if (typeof x !== 'string') { const o = x.options.find((v) => new RegExp(`\\b${esc(v)}\\b`, 'i').test(item)); if (o) { r[x.key] = o; if (note.toLowerCase() === o.toLowerCase()) note = '' } }
        for (const k of keys) { const m = new RegExp(`(\\w+) ${esc(k)}\\b`, 'i').exec(item); if (m && !r[k] && !['the', 'a', 'no'].includes(m[1].toLowerCase())) r[k] = m[1] }
        const w = keys.includes('weight') && /^(heavy|light|minor|major)\b\s*[—–-]?\s*/i.exec(note)
        if (w) { r.weight = w[1].toLowerCase(); note = note.slice(w[0].length) }
        const c = keys.includes('condition') && /^(conditional[\s,—–-]*|(?=if\b))(.*)$/is.exec(note)
        if (c) { r.condition = c[2] || 'conditional'; note = '' }
        if (note && !keys.includes('note') && keys.includes('condition')) r.condition = note.replace(/^(is|are)\s+/, '')
        else if (note) r.note = note
        out.push(r)
      } else if (out.length && !commas) out[out.length - 1].note = [out[out.length - 1].note, item].filter(Boolean).join('. ')
      else out.push({ text: item })
    }
    return out
  }

  /** "Label: value" paragraphs whose label names a field of the kind fill that field; the rest stay prose. */
  const fieldsFrom = (kind: string, paras: string[], job: ImportJob) => {
    const data: Record<string, unknown> = {}
    const rest: string[] = []
    for (const p of paras) {
      const m = /^([^:.]{2,40}): (.*)$/s.exec(p)
      const f = m && s.fields[kind]?.find((x) => [x.label, ...(x.aliases ?? [])].some((l) => l.toLowerCase() === m[1].trim().toLowerCase()))
      if (!m || !f) { rest.push(p); continue }
      const v = m[2].trim()
      if (f.key === 'act') {
        const a = /^(\w+)(?:\s*[—–-]\s*(.+))?/.exec(v)
        const n = a ? number(a[1]) : 0
        if (!n) { rest.push(p); continue }
        const act = known.find((d) => d.type === 'act' && d.order === n) ?? make('act', `Act ${a![1]}`, { order: n, subsections: [] }, '', `act_${n}`)
        if (a![2]) { act.subsections = [...new Set([...(act.subsections ?? []), a![2].trim()])]; data.subsection = a![2].trim() }
        data.act = act.id
      } else if (f.kind === 'rows') data[f.key] = rowsFrom(v, f, job)
      else if (f.kind === 'ref') data[f.key] = lookup(v, f.to!)?.id
      else if (f.kind === 'tags') data[f.key] = splitTop(v)
      else if (f.kind === 'number') data[f.key] = parseFloat(v) || undefined
      else if (f.kind === 'select') data[f.key] = f.options?.find((o) => o.toLowerCase() === v.toLowerCase()) ?? v
      else data[f.key] = v
    }
    return { data, rest }
  }

  /** A section's prose, tables and sub-sections as Markdown; branch tables go under the project's branch heading. */
  const body = (sec: Section, depth = 2, under = ''): string => sec.order.map((x) => {
    if (typeof x === 'string') return x
    if (isBranchTable(x)) return `${under.toLowerCase() === s.branches.toLowerCase() ? '' : `## ${s.branches}\n\n`}| Condition | Outcome | Pays off in |\n| --- | --- | --- |\n${x.slice(1).map((r) => `| ${cell(r[0] ?? '')} | ${cell(r[1] ?? '')} |  |`).join('\n')}`
    const note = x.length === 1 && x[0].length === 1 && /^([A-Z][A-Za-z ]{2,30}):\s*(.*)$/s.exec(x[0][0])
    if (note) return `## ${titleCase(note[1])}\n\n> ${note[2].replace(/\n+/g, ' ')}`
    return [x[0], x[0].map(() => '---'), ...x.slice(1)].map((r) => `| ${r.map(cell).join(' | ')} |`).join('\n')
  }).concat(sec.children.map((c) => `${'#'.repeat(Math.min(depth, 3))} ${titleCase(c.title)}\n\n${body(c, depth + 1, titleCase(c.title))}`)).filter(Boolean).join('\n\n')

  /** First names stand for a person when no one else shares them; so do short names used often in a profile (a nickname). */
  const aliasPeople = () => {
    const firsts = new Map<string, string[]>()
    for (const d of known.filter((d) => people.includes(d.type))) { const f = d.title.replace(HONORIFIC, '').split(' ')[0]; if (f !== d.title) firsts.set(f, [...(firsts.get(f) ?? []), d.id]) }
    for (const [f, ids] of firsts) if (ids.length === 1 && !names.some((n) => n.name === f)) names.push({ name: f, id: ids[0], type: known.find((d) => d.id === ids[0])!.type })
    for (const p of pages.filter((p) => people.includes(p.data.type))) {
      const first = p.data.title.replace(HONORIFIC, '').split(' ')[0]
      const freq = new Map<string, number>()
      for (const w of p.body.match(/\b[A-Z][a-z]{1,5}\b/g) ?? []) if (w !== first && first.toLowerCase().includes(w.toLowerCase())) freq.set(w, (freq.get(w) ?? 0) + 1)
      for (const [w, n] of freq) if (n >= 5) { p.data.aliases = [...(p.data.aliases ?? []), w]; names.push({ name: w, id: p.data.id, type: p.data.type }) }
    }
  }

  const hooks: { text: string; from: string }[] = []
  const ordered = [...jobs].sort((a, b) => +(a.kind === 'quest') - +(b.kind === 'quest'))
  let aliased = false
  for (const job of ordered) {
    if (!kindOf(s, job.kind)) { issues.push(`An import job names an unknown kind “${job.kind}”.`); continue }
    if (job.kind === 'quest' && !aliased) { aliasPeople(); aliased = true }
    for (const doc of docs.filter((d) => rx(job.file).test(d.name))) {
      const scope = job.under ? all(doc.root).filter((x) => rx(job.under!).test(x.title)) : [doc.root]
      if (job.pattern) {
        const re = rx(job.pattern)
        for (const p of [...new Set(scope.flatMap(all))].flatMap((x) => x.paras)) {
          const g = re.exec(p)?.groups
          if (!g) continue
          for (const t of g.list ? splitTop(g.list.replace(/,?\s*and so on$/i, '')).map((x) => x.replace(/^the\s+/i, '')) : [g.title])
            if (t) make(job.kind, t.trim(), { ...(g.order ? { order: number(g.order) } : {}), ...(job.set ?? {}) }, g.list ? '' : g.body ?? p, job.kind === 'act' && g.order ? `act_${number(g.order)}` : undefined)
        }
        continue
      }
      const secs = [...new Set(scope.flatMap(all))].filter((x) => x.level === job.level && (!job.match || rx(job.match).test(x.title)) && (!job.skip || !rx(job.skip).test(x.title)))
      for (const sec of secs) {
        let raw = sec.title.replace(/[“”"]/g, '')
        const code = CODE.exec(raw)
        if (code) raw = code[2]
        const comma = /^([^,]+),\s*(.+)$/.exec(raw)
        if (!code && comma && comma[1].split(' ').length <= 5) { raw = comma[1]; subtitles.set(comma[2].replace(/^the\s+/i, '').toLowerCase(), comma[1].trim()) }
        const title = titleCase(raw.trim())
        const isHook = (p: string) => !!job.hooks && p.startsWith(job.hooks)
        const { data, rest } = fieldsFrom(job.kind, sec.paras, job)
        const plain = title.replace(HONORIFIC, '')
        const also = [...(plain !== title ? [plain] : []), ...(job.aliases?.[title] ?? [])]
        const d: Partial<Data> = { ...(code ? { code: code[1] } : {}), ...(also.length ? { aliases: also } : {}), ...(job.kind === 'quest' ? { status: 'draft' } : {}), ...data }
        for (const [k, v] of Object.entries(job.set ?? {})) {
          const f = s.fields[job.kind]?.find((x) => x.key === k)
          d[k] = f?.kind === 'ref' && typeof v === 'string' ? resolve(f.to!, v).id : v
        }
        const gf = job.group && s.fields[job.kind]?.find((x) => x.key === job.group!.field)
        if (gf?.to?.length && sec.parent?.level && !(job.group!.skip && rx(job.group!.skip).test(sec.parent.title))) {
          const g = titleCase(sec.parent.title)
          d[gf.key] = resolve(gf.to, g, `“${g}” groups pages in ${doc.name}, but no ${kindName(gf.to[0])} has that name; one was created.`).id
        }
        const own = { ...sec, order: sec.order.filter((x) => typeof x !== 'string' || (rest.includes(x) && !isHook(x))) }
        const page = make(job.kind, title, d, body(own), job.kind === 'quest' && code ? `q_${code[1].toLowerCase()}` : undefined)
        for (const p of sec.paras.filter(isHook)) hooks.push({ text: p.slice(job.hooks!.length).trim(), from: page.id })
      }
    }
  }

  // Hooks become Idea quests with no act, waiting in the map's tray, given by the page they came from.
  const opening = /^## (.+)$/m.exec(s.template.quest ?? '')?.[1] ?? 'Description'
  for (const h of hooks) {
    let first = sentences(h.text)[0] ?? h.text
    const cut = first.slice(16).search(/[:;,—]/)
    if (cut >= 0) first = first.slice(0, cut + 16)
    const from = known.find((d) => d.id === h.from)!
    make('quest', first.length > 60 ? first.slice(0, 60).replace(/\s+\S*$/, '') + '…' : first,
      { status: 'idea', ...(giver && people.includes(from.type) ? { [giver.key]: [{ ref: h.from }] } : {}) }, `## ${opening}\n\n${h.text}`)
  }

  const counts: Record<string, number> = {}
  for (const p of pages) counts[p.data.type] = (counts[p.data.type] ?? 0) + 1
  return { pages, issues, counts }
}
