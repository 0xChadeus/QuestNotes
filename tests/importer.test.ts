// The importer on small synthetic documents (always), and on real documents when QUESTNOTES_DOCS and QUESTNOTES_CONFIG are set.
import { describe, expect, it } from 'vitest'
import { describe as outline, importDocs, suggest } from '../src/main/importer'
import { parsePage, writePage } from '../src/shared/page'
import { resolveSchema } from '../src/shared/schema'
import { CONFIG, DIR, JOBS, docx, h, p, real, synthetic } from './fixtures'

const s = resolveSchema()

describe('docx import, synthetic', () => {
  const r = importDocs(synthetic, JOBS, s, [])
  const q = r.pages.find((x) => x.data.id === 'q_mq02')!
  it('builds pages from every document', () => {
    expect(r.counts).toMatchObject({ location: 2, faction: 1, secret: 1, character: 4, act: 2, quest: 3 })
    expect(r.pages.find((x) => x.data.id === 'act_1')?.data.subsections).toEqual(['The Harbor', 'Rising Wind'])
    expect(r.pages.find((x) => x.data.id === 'ch_brother_tam')?.data).toMatchObject({ aliases: ['Tam'], home: 'lo_saltmarsh' })
  })
  it('turns prose fields into rows', () => {
    expect(q.data).toMatchObject({ code: 'MQ02', title: 'Night Tide', act: 'act_1', subsection: 'The Harbor', status: 'draft' })
    expect(q.data.giver).toEqual([{ ref: 'ch_mara_quill' }])
    expect(q.data.involved).toEqual([{ ref: 'ch_mara_quill' }, { ref: 'ch_brother_tam' }, { text: 'several dock workers' },
      { ref: 'ch_gull', note: 'heavy — her waters' }, { ref: 'ch_captain_oren_hale', condition: 'if questioned' }])
    expect(q.data.locations).toEqual([{ ref: 'lo_saltmarsh', note: 'The fog is thick' }])
    expect(q.data.factions).toEqual([{ ref: 'fa_the_tide_guild', direction: 'down' }])
    expect(q.data.reveals).toEqual([{ none: true, note: 'Nothing is learned' }])
    expect(q.body).toContain('## Branches\n\n| Condition | Outcome | Pays off in |')
    expect(q.body).toContain('| Player tells the Guild | Trust drops \\| a lot |  |')
    expect(q.body).toContain('> Keep it quiet.')
  })
  it('makes hooks Idea quests and lists what a person must settle', () => {
    expect(r.pages.some((x) => x.data.type === 'quest' && x.data.status === 'idea' && x.data.giver?.[0].ref === 'ch_brother_tam')).toBe(true)
    expect(r.issues.join('\n')).toMatch(/“Lantern Row” groups pages/)
    expect(r.issues.join('\n')).toMatch(/“Gull”.*Captain Oren Hale/)
  })
  it('suggests jobs from file names and quest codes, and outlines each document', () => {
    expect(suggest(synthetic, s)).toEqual([{ file: 'Characters\\.docx', kind: 'character', level: 1 }, expect.objectContaining({ file: 'Quests\\.docx', kind: 'quest', level: 1 })])
    expect(outline(synthetic)[0].outline).toContain('    H3 Saltmarsh  (1 ¶)')
  })
  it('works with any project schema', () => {
    const custom = resolveSchema({
      kinds: [{ id: 'npc', label: 'NPC', prefix: 'npc' }],
      fields: { quest: [{ key: 'contact', label: 'Contact', aliases: ['Given by'], kind: 'rows', to: ['npc'], extras: ['note'], giver: true }] },
    })
    const doc = docx('Jobs.docx', h(1, 'J1 — THE LEDGER') + p('Given by: Ash Morrow (reluctantly)') + p('Pay: 40 crowns'))
    const out = importDocs([doc], [{ file: 'Jobs', kind: 'quest', level: 1, create: ['npc'] }], custom, [])
    expect(out.pages.find((x) => x.data.type === 'quest')?.data).toMatchObject({ code: 'J1', contact: [{ ref: 'npc_ash_morrow', note: 'reluctantly' }] })
    expect(out.pages.find((x) => x.data.type === 'quest')?.body).toContain('Pay: 40 crowns')
    expect(out.counts).toEqual({ npc: 1, quest: 1 })
  })
})

describe.skipIf(!DIR || !CONFIG)('docx import, real documents', () => {
  const r = DIR && CONFIG ? importDocs(real(), CONFIG.import ?? [], resolveSchema(CONFIG), []) : { pages: [] }
  it('creates pages', () => expect(r.pages.length).toBeGreaterThan(0))
  it('writes every page so it reads back unchanged', () => {
    for (const p of r.pages) { const text = writePage(p.data, p.body); const b = parsePage(text); expect(writePage(b.data, b.body)).toBe(text) }
  })
})
