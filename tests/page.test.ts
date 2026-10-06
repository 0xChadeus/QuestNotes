import { describe, expect, it } from 'vitest'
import { addPayoff, branches, parsePage, refsOf, removePayoff, writePage, writeYaml } from '../src/shared/page'
import { parse } from 'yaml'
import { mergeText } from '../src/shared/merge'
import { questState, resolveEngine, type EngineIndex } from '../src/shared/engine'
import { resolveSchema } from '../src/shared/schema'
import { scan } from '../src/main/engine'
import path from 'node:path'

const s = resolveSchema()
const data = {
  id: 'q_mq02', type: 'quest' as const, title: 'Night Tide', code: 'MQ02', status: 'ready', act: 'act_1', subsection: 'The Harbor',
  giver: [{ ref: 'ch_mara_quill' }],
  factions: [{ ref: 'fa_tide_guild', direction: 'down', note: 'first sign of trouble, sets up the harbour strike' }],
  involved: [{ ref: 'ch_gull', note: 'her waters' }, { text: 'several dock workers' }, { ref: 'ch_oren_hale', condition: 'if questioned: maybe' }],
  engine: { id: 'mq02', kind: 'main', linked_on: null, handoff_on: '2026-10-05' },
  odd: ['no', 'yes', 'on', '2026-10-05', '#hash', 'a: b'],
}
const body = `## Branches

| Condition | Outcome | Pays off in |
| --- | --- | --- |
| Player finds the cut ropes | Caves set up early | [[q_mq03]] |
| Player tells the Guild | Mara's trust drops |  |
`

describe('page files', () => {
  it('writes canonical YAML that reads back to the same data and the same bytes', () => {
    const text = writePage(data, body)
    const p = parsePage(text)
    expect(p.data).toEqual({ ...data, engine: { id: 'mq02', kind: 'main', handoff_on: '2026-10-05' } })
    expect(p.body).toBe(body)
    expect(writePage(p.data, p.body)).toBe(text)
    expect(text).toContain('  - {ref: fa_tide_guild, direction: down, note: "first sign of trouble, sets up the harbour strike"}')
  })
  it('quotes values YAML would misread', () => {
    expect(parse(writeYaml({ v: ['no', 'yes', '2026-10-05', 'x, y: z'] })).v).toEqual(['no', 'yes', '2026-10-05', 'x, y: z'])
  })
  it('finds references, branching rows and payoffs', () => {
    const p = parsePage(writePage(data, body))
    expect(refsOf(s, p).sort()).toEqual(['act_1', 'ch_gull', 'ch_mara_quill', 'ch_oren_hale', 'fa_tide_guild', 'q_mq03'])
    const b = branches(p.body, s.branches)
    expect(b.map((r) => r.targets)).toEqual([['q_mq03'], []])
    expect(addPayoff(p.body, b[1].line, 'fa_tide_guild')).toContain('| Player tells the Guild | Mara\'s trust drops | [[fa_tide_guild]] |')
    expect(branches(p.body, 'Choices')).toEqual([])
    const linked = addPayoff(addPayoff(p.body, b[1].line, 'fa_tide_guild'), b[1].line, 'q_mq05')
    expect(removePayoff(linked, b[1].line, 'fa_tide_guild')).toContain('| Player tells the Guild | Mara\'s trust drops | [[q_mq05]] |')
    expect(removePayoff(p.body, b[0].line, 'q_mq03')).toBe(p.body.replace('[[q_mq03]]', ''))
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
  const q = (status: string, engine?: object) => ({ id: 'q', type: 'quest' as const, title: 'Q', status, engine })
  it('derives every state', () => {
    expect(questState(q('draft'), null)).toBe('unknown')
    expect(questState(q('draft'), index)).toBe('none')
    expect(questState(q('ready', { id: 'mq09' }), index)).toBe('needs')
    expect(questState(q('ready', { id: 'mq01' }), index)).toBe('link')
    expect(questState(q('ready', { id: 'mq01', linked_on: '2026-10-01' }), index)).toBe('built')
    expect(questState(q('ready', { id: 'mq02', linked_on: '2026-10-01' }), index)).toBe('stub')
    expect(questState(q('ready', { id: 'gone', linked_on: '2026-10-01' }), index)).toBe('missing')
    expect(questState(q('ready', { id: 'dup' }), index)).toBe('duplicate')
  })
})

describe('engine scan', () => {
  const game = path.join(__dirname, 'bridge/project')
  it('reads quests as a preset describes them', async () => {
    const i = await scan(game, resolveEngine({ preset: 'animus' })!)
    expect(i.quests.mq01).toEqual([{ path: 'res://resources/quests/main/mq01.json', kind: 'main', title: 'The First Errand', stages: ['meet_keeper', 'done'], stub: false }])
  })
  it('reads quests as a custom config describes them', async () => {
    const i = await scan(game, resolveEngine({ name: 'Custom', quests: { files: 'resources/**/*.json', id: 'quest_id', stages: 'stages' } })!)
    expect(i.quests.mq01).toEqual([{ path: 'resources/quests/main/mq01.json', kind: '', title: 'mq01', stages: ['meet_keeper', 'done'], stub: false }])
    expect(resolveEngine({ preset: 'animus', name: 'Ours' })).toMatchObject({ name: 'Ours', adapter: 'animus' })
  })
})
