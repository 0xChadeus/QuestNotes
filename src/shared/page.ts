// Page files: a YAML 1.2 header written only by this canonical writer, then a Markdown body.
import { parse, parseDocument, stringify, visit, isSeq } from 'yaml'
import { FIELDS, TYPE_INFO, type PageType, type Row } from './schema'

export type Data = Record<string, any> & { id: string; type: PageType; title: string }
export interface Page { file: string; data: Data; body: string }

const FRONT = /^---\n([\s\S]*?\n)?---\n\n?/

export function parsePage(text: string, file = ''): Page {
  const m = FRONT.exec(text.replace(/\r\n/g, '\n'))
  if (!m) throw new Error(`${file}: no front matter`)
  return { file, data: (parse(m[1] ?? '') ?? {}) as Data, body: text.slice(m[0].length) }
}

/** Top-level keys one per line, list items as one-line {…} maps, quoting only where needed, never folded. */
export function writeYaml(obj: object): string {
  const doc = parseDocument(stringify(obj, { lineWidth: 0 }))
  visit(doc, { Map(_, node, path) { if (path.length > 2 && isSeq(path[path.length - 1])) node.flow = true } })
  return doc.toString({ lineWidth: 0, flowCollectionPadding: false })
}

export const canonBody = (md: string) => (md.trim() ? md.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '') + '\n' : '')

export function writePage(data: Data, body: string): string {
  const b = canonBody(body)
  return `---\n${writeYaml(clean(data))}---\n${b && '\n' + b}`
}

/** Drops empty values so a cleared field leaves no trace in the file. */
function clean<T>(v: T): T {
  if (Array.isArray(v)) return v.map(clean).filter((x) => !isEmpty(x)) as T
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clean(x)]).filter(([, x]) => !isEmpty(x))) as T
  return v
}
const isEmpty = (x: unknown) => x === undefined || x === null || x === '' || (Array.isArray(x) && !x.length) || (typeof x === 'object' && x !== null && !Array.isArray(x) && !Object.keys(x).length)

const slug = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 48) || 'page'

export function newId(type: PageType, title: string, taken: (id: string) => boolean): string {
  const base = `${TYPE_INFO[type].prefix}_${slug(title)}`
  let id = base
  for (let i = 2; taken(id); i++) id = `${base}_${i}`
  return id
}

export const fileFor = (type: PageType, id: string) => `${TYPE_INFO[type].dir}/${id}.md`

const LINK = /\[\[([a-z0-9_\/-]+)(?:\|[^\]]*)?\]\]/g
const bodyLinks = (body: string) => [...body.matchAll(LINK)].map((m) => m[1])

/** Every page id a page points at, from its header fields and its body. */
export function refsOf(p: Page): string[] {
  const out = new Set<string>(bodyLinks(p.body))
  for (const f of FIELDS[p.data.type] ?? []) {
    const v = p.data[f.key]
    if (f.kind === 'ref' && typeof v === 'string') out.add(v)
    if (f.kind === 'rows' && Array.isArray(v)) for (const r of v as Row[]) if (r?.ref) out.add(r.ref)
  }
  out.delete(p.data.id)
  return [...out]
}

/** Branching-surface rows: the table under "## Branching surfaces", one line per row. */
export interface Branch { line: number; condition: string; outcome: string; payoff: string; targets: string[] }
export function branches(body: string): Branch[] {
  const lines = body.split('\n')
  const h = lines.findIndex((l) => /^#{2,3}\s+branching surfaces/i.test(l))
  if (h < 0) return []
  const out: Branch[] = []
  let seenTable = false
  for (let i = h + 1; i < lines.length; i++) {
    const l = lines[i]
    if (/^#{1,3}\s/.test(l)) break
    if (!l.startsWith('|')) { if (seenTable) break; continue }
    seenTable = true
    const cells = splitRow(l)
    if (cells.every((c) => /^:?-+:?$/.test(c)) || /^branch condition$/i.test(cells[0])) continue
    out.push({ line: i, condition: cells[0] ?? '', outcome: cells[1] ?? '', payoff: cells[2] ?? '', targets: bodyLinks(cells[2] ?? '') })
  }
  return out
}
const splitRow = (l: string) => l.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => c.trim())

/** Adds a [[target]] to the "Pays off in" cell of one branching row. */
export function addPayoff(body: string, line: number, target: string): string {
  const lines = body.split('\n')
  const cells = splitRow(lines[line])
  while (cells.length < 3) cells.push('')
  if (!bodyLinks(cells[2]).includes(target)) cells[2] = `${cells[2]} [[${target}]]`.trim()
  lines[line] = `| ${cells.join(' | ')} |`
  return lines.join('\n')
}

export const HONORIFIC = /^(Captain|Brother|Father|Corporal|Doctor|Old|Lady|Lord|Sister|Mother|Master|Sergeant)\s+/

export const today = () => new Date().toISOString().slice(0, 10)
