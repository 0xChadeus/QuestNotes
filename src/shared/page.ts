// Page files: a YAML 1.2 header written only by this canonical writer, then a Markdown body.
import { parse, parseDocument, stringify, visit, isSeq } from 'yaml'
import { kindOf, type Row, type Schema } from './schema'

export type Data = Record<string, any> & { id: string; type: string; title: string }
export interface Page { file: string; data: Data; body: string }

const FRONT = /^---\n([\s\S]*?\n)?---\n\n?/

/** Reads a page. A header without a title (an empty title is never written), id or type still makes a page: the id comes
 *  from the file name, the type from its folder (`kinds` maps folder to type), the title is empty. */
export function parsePage(text: string, file = '', kinds: Record<string, string> = {}): Page {
  const m = FRONT.exec(text.replace(/\r\n/g, '\n'))
  if (!m) throw new Error(`${file}: no front matter`)
  const data = parse(m[1] ?? '') ?? {}
  if (typeof data !== 'object' || Array.isArray(data)) throw new Error(`${file}: the header is not a set of fields`)
  data.id = String(data.id ?? file.split('/').pop()!.replace(/(~\d+)?\.md$/, ''))
  data.type = String(data.type ?? kinds[file.split('/')[0]] ?? '')
  data.title = data.title == null ? '' : String(data.title)
  return { file, data: data as Data, body: text.slice(m[0].length) }
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

export function newId(s: Schema, type: string, title: string, taken: (id: string) => boolean): string {
  const base = `${kindOf(s, type)?.prefix ?? type}_${slug(title)}`
  let id = base
  for (let i = 2; taken(id); i++) id = `${base}_${i}`
  return id
}

export const fileFor = (s: Schema, type: string, id: string) => `${kindOf(s, type)?.dir ?? type}/${id}.md`

const LINK = /\[\[([a-z0-9_\/-]+)(?:\|[^\]]*)?\]\]/g
const bodyLinks = (body: string) => [...body.matchAll(LINK)].map((m) => m[1])

/** Every page id a page points at, from its header fields and its body. */
export function refsOf(s: Schema, p: Page): string[] {
  const out = new Set<string>(bodyLinks(p.body))
  for (const f of s.fields[p.data.type] ?? []) {
    const v = p.data[f.key]
    if (f.kind === 'ref' && typeof v === 'string') out.add(v)
    if (f.kind === 'rows' && Array.isArray(v)) for (const r of v as Row[]) if (r?.ref) out.add(r.ref)
  }
  out.delete(p.data.id)
  return [...out]
}

/** Branch rows: the table under the project's branch heading ("## Branches" by default), one line per row. */
export interface Branch { line: number; condition: string; outcome: string; payoff: string; targets: string[] }
export function branches(body: string, heading: string): Branch[] {
  const lines = body.split('\n')
  const h = lines.findIndex((l) => /^#{2,3}\s/.test(l) && l.replace(/^#+\s+/, '').trim().toLowerCase() === heading.toLowerCase())
  if (h < 0) return []
  const out: Branch[] = []
  let row = 0
  for (let i = h + 1; i < lines.length; i++) {
    const l = lines[i]
    if (/^#{1,3}\s/.test(l)) break
    if (!l.startsWith('|')) { if (row) break; continue }
    const cells = splitRow(l)
    if (row++ < 2) continue // the header and its --- line
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

/** Takes a [[target]] (with or without a label) out of the "Pays off in" cell of one branching row. */
export function removePayoff(body: string, line: number, target: string): string {
  const lines = body.split('\n')
  const cells = splitRow(lines[line])
  if (cells.length < 3) return body
  cells[2] = cells[2].replace(new RegExp(`\\s*\\[\\[${target.replace(/[/]/g, '\\/')}(\\|[^\\]]*)?\\]\\]`, 'g'), '').trim()
  lines[line] = `| ${cells.join(' | ')} |`
  return lines.join('\n')
}

/** Titles before a name, so "Captain Ada Reyes" is also found as "Ada Reyes". */
export const HONORIFIC = /^(Captain|Commander|General|Sergeant|Corporal|Lieutenant|Brother|Sister|Father|Mother|Lady|Lord|Sir|Dame|Doctor|Dr\.?|Mr\.?|Mrs\.?|Ms\.?|Professor|Master|King|Queen|Prince|Princess|Old)\s+/

export const today = () => new Date().toISOString().slice(0, 10)
