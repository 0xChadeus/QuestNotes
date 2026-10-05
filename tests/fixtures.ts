// Design-document fixtures: small synthetic .docx files and the import jobs for them. Set QUESTNOTES_DOCS to a folder of
// real documents and QUESTNOTES_CONFIG to the questnotes.yaml whose import jobs read them, to test against those too.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { strToU8, zipSync } from 'fflate'
import { parse } from 'yaml'
import type { ImportJob, ProjectConfig } from '../src/shared/schema'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
const p = (text: string, style = '') => `<w:p>${style && `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>`}<w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`
const h = (n: number, text: string) => p(text, `Heading${n}`)
const table = (rows: string[][]) => `<w:tbl>${rows.map((r) => `<w:tr>${r.map((c) => `<w:tc>${p(c)}</w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>`
export const docx = (name: string, body: string) => ({ name, data: zipSync({ 'word/document.xml': strToU8(`<w:document><w:body>${body}</w:body></w:document>`) }) })
export { h, p }

export const synthetic = [
  docx('World.docx', h(1, 'PART I: PLACES') + h(2, 'Places') + h(3, 'Saltmarsh') + p('The low district.') + h(1, 'PART II: FACTIONS') + h(2, 'The Tide Guild') + p('Runs the docks.')
    + h(1, 'PART III: SECRETS') + h(2, 'Who Sank the Meridian?') + p('Nobody knows.')),
  docx('Characters.docx', h(1, 'MARA QUILL') + h(2, 'Early Life') + p('Mara grew up on the docks.')),
  docx('People_of_the_Harbor.docx', h(1, 'SALTMARSH') + h(2, 'Brother Tam, Keeper of the Lighthouse') + p('He keeps the light.') + p('[QUEST HOOK] Tam’s missing lens can lead the player into the caves.')
    + h(1, 'LANTERN ROW') + h(2, 'Captain Oren Hale, the Gull') + p('A captain.')),
  docx('Story.docx', h(1, 'THE STRUCTURE') + p('Act I — Calm Waters. Setup.') + p('Act II — The Storm. Escalation.')),
  docx('Quests.docx', h(1, 'MQ02 — NIGHT TIDE') + p('Act: I — The Harbor') + p('Quest giver: Mara Quill')
    + p('Involved: Mara, Brother Tam, several dock workers, Gull (heavy — her waters), Oren Hale (conditional, if questioned).')
    + p('Locations: Saltmarsh. The fog is thick.') + p('Faction standing: The Tide Guild (down).') + p('Reveals: None. Nothing is learned.')
    + h(2, 'Description') + p('Mara asks for help.') + h(2, 'Branches')
    + table([['CHOICE', 'OUTCOME'], ['Player tells the Guild', 'Trust drops | a lot']]) + table([['DEVELOPER NOTE: Keep it quiet.']])
    + h(1, 'MQ03 — UNDER THE PIER') + p('Act: I — Rising Wind') + p('Quest giver: Mara Quill') + h(2, 'Description') + p('Into the dark.')),
]

export const JOBS: ImportJob[] = [
  { file: 'World', kind: 'location', level: 3, under: 'Places' },
  { file: 'World', kind: 'faction', level: 2, under: 'FACTIONS' },
  { file: 'World', kind: 'secret', level: 2, under: 'SECRETS' },
  { file: 'Characters', kind: 'character', level: 1 },
  { file: 'People', kind: 'character', level: 2, group: { field: 'home' }, hooks: '[QUEST HOOK]' },
  { file: 'Story', kind: 'act', pattern: '^Act (?<order>[IVX]+) — (?<title>[^.]+)\\.' },
  { file: 'Quests', kind: 'quest', level: 1, match: '^[A-Z]+\\d+ —', create: ['character'] },
]

/** Real documents and their project config, when this machine has them. */
export const DIR = process.env.QUESTNOTES_DOCS
export const CONFIG: ProjectConfig | undefined = process.env.QUESTNOTES_CONFIG ? parse(readFileSync(process.env.QUESTNOTES_CONFIG, 'utf8')) : undefined
export const real = () => {
  const walk = (d: string): string[] => readdirSync(d).flatMap((n) => statSync(path.join(d, n)).isDirectory() ? walk(path.join(d, n)) : [path.join(d, n)])
  return walk(DIR!).filter((f) => f.endsWith('.docx')).map((f) => ({ name: path.basename(f), data: new Uint8Array(readFileSync(f)) }))
}
