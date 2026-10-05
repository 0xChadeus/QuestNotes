import { describe, expect, it } from 'vitest'
import { addPayoff, branches, parsePage, refsOf, writePage, writeYaml } from '../src/shared/page'
import { parse } from 'yaml'
import { mergeText } from '../src/shared/merge'
import { questState, type EngineIndex } from '../src/shared/engine'

const data = {
  id: 'q_mq02', type: 'quest' as const, title: 'Night Life', code: 'MQ02', status: 'ready', act: 'act_1', subsection: 'The Quiet City',
  issuer: [{ ref: 'ch_lyra_frost' }],
  thresholds: [{ ref: 'th_conspiracy', vector: 'Investigation', note: 'first murder thread, seeds the geographic pattern' }],
  exposed: [{ ref: 'ch_sparrow', weight: 'heavy' }, { text: 'multiple Ashfield residents' }, { ref: 'ch_sera_vance', condition: 'if interviewed: maybe' }],
  animus: { quest_id: 'mq02', kind: 'main', linked_on: null, handoff_on: '2026-10-05' },
  odd: ['no', 'yes', 'on', '2026-10-05', '#hash', 'a: b'],
}
const body = `## Branching surfaces

| Branch condition | Outcome | Pays off in |
| --- | --- | --- |
| Player finds the vertical blood trail | Undercity seeded early | [[q_mq03]] |
| Player reports to Marcus | Lyra's trust drops |  |
`

describe('page files', () => {
  it('writes canonical YAML that reads back to the same data and the same bytes', () => {
    const text = writePage(data, body)
    const p = parsePage(text)
    expect(p.data).toEqual({ ...data, animus: { quest_id: 'mq02', kind: 'main', handoff_on: '2026-10-05' } })
    expect(p.body).toBe(body)
    expect(writePage(p.data, p.body)).toBe(text)
    expect(text).toContain('  - {ref: th_conspiracy, vector: Investigation, note: "first murder thread, seeds the geographic pattern"}')
  })
  it('quotes values YAML would misread', () => {
    expect(parse(writeYaml({ v: ['no', 'yes', '2026-10-05', 'x, y: z'] })).v).toEqual(['no', 'yes', '2026-10-05', 'x, y: z'])
  })
  it('finds references, branching rows and payoffs', () => {
    const p = parsePage(writePage(data, body))
    expect(refsOf(p).sort()).toEqual(['act_1', 'ch_lyra_frost', 'ch_sera_vance', 'ch_sparrow', 'q_mq03', 'th_conspiracy'])
    const b = branches(p.body)
    expect(b.map((r) => r.targets)).toEqual([['q_mq03'], []])
    expect(addPayoff(p.body, b[1].line, 'th_conspiracy')).toContain('| Player reports to Marcus | Lyra\'s trust drops | [[th_conspiracy]] |')
  })
})

describe('sync merge', () => {
  const base = 'a\n| r1 | x |\n| r2 | y |\nstatus: draft\nz'
  it('merges edits to neighbouring rows', () => {
    const r = mergeText(base, base.replace('| x |', '| x1 |'), base.replace('| y |', '| y2 |'))
    expect(r.conflicts).toEqual([])
    expect(r.text).toBe('a\n| r1 | x1 |\n| r2 | y2 |\nstatus: draft\nz')
  })
  it('keeps same-field edits as conflicts', () => {
    const r = mergeText(base, base.replace('draft', 'review'), base.replace('draft', 'ready'))
    expect(r.conflicts).toEqual([{ base: 'status: draft', ours: 'status: review', theirs: 'status: ready' }])
  })
})

describe('engine link states', () => {
  const index: EngineIndex = {
    scanned: '2026-10-05', source: 'game', characters: ['tia'],
    quests: { mq01: [{ path: 'res://resources/quests/main/mq01.json', kind: 'main', title: 'Welcome', stages: ['a', 'b'], stub: false }],
      mq02: [{ path: 'p', kind: 'main', title: 'Mq 02', stages: ['start'], stub: true }],
      dup: [{ path: 'a', kind: 'main', title: '', stages: [], stub: true }, { path: 'b', kind: 'side', title: '', stages: [], stub: true }] },
  }
  const q = (status: string, animus?: object) => ({ id: 'q', type: 'quest' as const, title: 'Q', status, animus })
  it('derives every state', () => {
    expect(questState(q('draft'), null)).toBe('unknown')
    expect(questState(q('draft'), index)).toBe('none')
    expect(questState(q('ready', { quest_id: 'mq09' }), index)).toBe('needs')
    expect(questState(q('ready', { quest_id: 'mq01' }), index)).toBe('link')
    expect(questState(q('ready', { quest_id: 'mq01', linked_on: '2026-10-01' }), index)).toBe('built')
    expect(questState(q('ready', { quest_id: 'mq02', linked_on: '2026-10-01' }), index)).toBe('stub')
    expect(questState(q('ready', { quest_id: 'gone', linked_on: '2026-10-01' }), index)).toBe('missing')
    expect(questState(q('ready', { quest_id: 'dup' }), index)).toBe('duplicate')
  })
})
