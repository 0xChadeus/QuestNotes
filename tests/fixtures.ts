// Design-document fixtures: small synthetic .docx files, or the real Broken Wings documents when this machine has them.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { strToU8, zipSync } from 'fflate'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
const p = (text: string, style = '') => `<w:p>${style && `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>`}<w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`
const h = (n: number, text: string) => p(text, `Heading${n}`)
const table = (rows: string[][]) => `<w:tbl>${rows.map((r) => `<w:tr>${r.map((c) => `<w:tc>${p(c)}</w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>`
const docx = (name: string, body: string) => ({ name, data: zipSync({ 'word/document.xml': strToU8(`<w:document><w:body>${body}</w:body></w:document>`) }) })

export const synthetic = [
  docx('World_Purgatory.docx', h(1, 'PART I: THE SHAPE') + h(2, 'The Districts') + h(3, 'Ashfield') + p('The edge district.') + h(1, 'PART IV: THE FACTIONS') + h(2, 'The Guild of the Fallen') + p('Runs the city.') + h(1, 'PART VII: THE MYSTERIES') + h(2, 'Who Is the Pale Woman?') + p('Nobody knows.')),
  docx('Characters.docx', h(1, 'LYRA FROST') + h(2, 'The Girl She Was') + p('Lyra was born a baron’s daughter.')),
  docx('Faces_of_Purgatory.docx', h(1, 'ASHFIELD') + h(2, 'Father Maren, Priest of Ashfield') + p('He keeps the chapel.') + p('[QUEST HOOK] Maren’s missing bell can lead the player into the Undercity.') + h(1, 'HALFORD') + h(2, 'Captain Sera Vance, the Sparrow') + p('A captain.')),
  docx('Narrative.docx', h(1, 'THE THREE-ACT STRUCTURE') + p('Act I — The Weight of Ordinary Days. Establishment.') + p('Act II — The Ground Shifts. Escalation.')),
  docx('Quests.docx', h(1, 'QUEST SCHEMA') + p('Threshold contributions. Which Act III thresholds this quest can feed — Conspiracy, Sera’s Network, and so on.')
    + h(1, 'LEAK CHANNELS') + p('The default channel is direct witness.') + p('Secondary channels require setup:') + p('Stair Parlour gossip carries information about anything domestic.')
    + h(1, 'MQ02 — NIGHT LIFE') + p('Act: I — The Quiet City') + p('Issuer: Lyra Frost') + p('Sanctioning sub-factions: Guild (Lyra track).')
    + p('Exposed characters: Lyra, Father Maren, multiple Ashfield residents, Sparrow (heavy — her territory), Sera Vance (conditional, if interviewed).')
    + p('Renown impact: Ashfield (heavy). Direction depends on how Ed treats people.') + p('Anchor pressure: Lyra’s Bond anchor is pressured.')
    + p('Morale impact: None. Nothing moves.') + p('Threshold contributions: Conspiracy (Investigation vector — first thread). Lyra’s Late-Game Standing.')
    + p('Leak channels: Stair Parlour gossip if Thornside witnesses are interviewed.')
    + h(2, 'Description') + p('Lyra Frost approaches Ed.') + h(2, 'Execution vectors') + p('Method. Social.') + h(2, 'Branching surfaces')
    + table([['BRANCH CONDITION', 'OUTCOME'], ['Player reports to Marcus', 'Trust drops | a lot']]) + table([['DEVELOPER NOTE: Make it disturbing.']])
    + h(1, 'MQ03 — BELOW THE SURFACE') + p('Act: I — First Cracks') + p('Issuer: Lyra Frost') + h(2, 'Description') + p('Ed goes below.')),
]

export const DIR = process.env.QUESTNOTES_DOCS ?? path.resolve(__dirname, '../../brokenwings/design_docs')
export const docs = () => existsSync(DIR) ? ['lore', 'quests_and_narrative'].flatMap((d) =>
  readdirSync(path.join(DIR, d)).filter((f) => f.endsWith('.docx')).map((f) => ({ name: f, data: new Uint8Array(readFileSync(path.join(DIR, d, f))) }))) : synthetic

