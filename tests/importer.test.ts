// The importer on small synthetic documents (always), and on the real Broken Wings documents when this machine has them.
import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { importDocs } from '../src/main/importer'
import { parsePage, writePage } from '../src/shared/page'
import { DIR, docs, synthetic } from './fixtures'

describe('docx import, synthetic', () => {
  const r = importDocs(synthetic, [])
  const q = r.pages.find((x) => x.data.id === 'q_mq02')!
  it('builds pages from every document', () => {
    expect(r.counts).toMatchObject({ district: 2, faction: 1, mystery: 1, act: 2, threshold: 3, leak: 2, questline: 1 })
    expect(r.pages.find((x) => x.data.id === 'act_1')?.data.subsections).toEqual(['The Quiet City', 'First Cracks'])
  })
  it('turns prose fields into rows', () => {
    expect(q.data.issuer).toEqual([{ ref: 'ch_lyra_frost' }])
    expect(q.data.sanctioning).toEqual([{ ref: 'fa_the_guild_of_the_fallen', note: 'Lyra track' }])
    expect(q.data.exposed).toEqual([{ ref: 'ch_lyra_frost' }, { ref: 'ch_father_maren' }, { text: 'multiple Ashfield residents' },
      { ref: 'ch_sparrow', weight: 'heavy', note: 'her territory' }, { ref: 'ch_captain_sera_vance', condition: 'if interviewed' }])
    expect(q.data.renown).toEqual([{ ref: 'di_ashfield', note: 'heavy. Direction depends on how Ed treats people' }])
    expect(q.data.anchor_pressure[0]).toMatchObject({ ref: 'ch_lyra_frost', anchor: 'bond' })
    expect(q.data.morale).toEqual([{ none: true, note: 'Nothing moves' }])
    expect(q.data.thresholds).toEqual([{ ref: 'th_conspiracy', vector: 'Investigation', note: 'Investigation vector — first thread' }, { ref: 'th_lyras_late_game_standing' }])
    expect(q.data.leaks).toEqual([{ ref: 'lc_stair_parlour_gossip', condition: 'if Thornside witnesses are interviewed' }])
    expect(q.body).toContain('| Player reports to Marcus | Trust drops \\| a lot |  |')
    expect(q.body).toContain('> Make it disturbing.')
  })
  it('makes hooks Idea quests and lists what a person must settle', () => {
    expect(r.pages.some((x) => x.data.type === 'quest' && x.data.status === 'idea' && x.data.issuer?.[0].ref === 'ch_father_maren')).toBe(true)
    expect(r.issues.join('\n')).toMatch(/Halford is a district/)
    expect(r.issues.join('\n')).toMatch(/“Sparrow”.*Captain Sera Vance/)
  })
})

describe.skipIf(!existsSync(DIR))('docx import, Broken Wings documents', () => {
  const r = importDocs(docs(), [])
  it('creates the pages the documents describe', () => {
    expect(r.counts).toMatchObject({ threshold: 8, leak: 8, mystery: 8, district: 10, faction: 11, act: 3 })
    expect(r.counts.character).toBeGreaterThanOrEqual(58)
  })
  it('writes every page so it reads back unchanged', () => {
    for (const p of r.pages) { const text = writePage(p.data, p.body); const b = parsePage(text); expect(writePage(b.data, b.body)).toBe(text) }
  })
})
