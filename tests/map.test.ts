// The free-form map: the one-time move from the grid, the keyed merge, placement helpers, JSON Canvas, and ELK's Tidy.
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { CARD_H, CARD_W, align, edit, freeSpot, fromCanvas, mergeMaps, migrateMap, place, tidyMap, toCanvas, type MapView } from '../src/shared/map'
import { writeYaml, type Data } from '../src/shared/page'
import { layered } from '../src/renderer/src/tidy'

const d = (id: string, type: string, more: Partial<Data> = {}): Data => ({ id, type, title: id, ...more })
const lore = [
  d('act_1', 'act', { order: 1, title: 'Calm', subsections: ['Harbor', 'Pier'] }), d('act_2', 'act', { order: 2, title: 'Storm' }),
  d('ql_main', 'questline', { order: 1 }),
  d('q_a', 'quest', { code: 'Q1', act: 'act_1', subsection: 'Harbor', questline: 'ql_main' }),
  d('q_b', 'quest', { code: 'Q2', act: 'act_1', subsection: 'Pier', questline: 'ql_main' }),
  d('q_c', 'quest', { code: 'Q3', act: 'act_1', subsection: 'Harbor', questline: 'ql_main' }),
  d('q_d', 'quest', { code: 'Q4', act: 'act_2' }),
  d('q_hook', 'quest', { code: 'Q5' }),
]

describe('moving from the grid', () => {
  const m = migrateMap(lore, { cells: { 'act_1|Harbor|ql_main': ['q_c', 'q_a'] } })
  const at = (id: string) => m.nodes!.find((n) => n.id === id)
  it('places each quest where the grid showed it, keeping the order of cards inside a cell', () => {
    expect(at('q_c')!.y).toBeLessThan(at('q_a')!.y)
    expect(at('q_a')!.x).toBe(at('q_c')!.x)
    expect(at('q_b')!.x).toBe(at('q_a')!.x + 270)
    expect(at('q_d')!.x).toBe(at('q_a')!.x + 540)
    expect(at('q_d')!.y).toBeGreaterThan(at('q_a')!.y)
    expect(at('q_hook')).toBeUndefined()
  })
  it('draws a frame around each act and gives the same file every time', () => {
    expect(m.frames!.map((f) => [f.id, f.label, f.w])).toEqual([['f_act_1', 'Act I · Calm', 528], ['f_act_2', 'Act II · Storm', 258]])
    expect(writeYaml(migrateMap(lore, {}))).toBe(writeYaml(migrateMap([...lore].reverse(), {})))
  })
  it('writes one line per item, sorted by id', () => {
    const text = writeYaml(tidyMap({ nodes: [{ id: 'q_b', x: 1.4, y: 2 }, { id: 'q_a', x: 3, y: 4 }] }))
    expect(text).toBe('version: 2\nnodes:\n  - {id: q_a, x: 3, y: 4}\n  - {id: q_b, x: 1, y: 2}\n')
  })
})

describe('merging two designers\' maps', () => {
  const base: MapView = tidyMap({ nodes: [{ id: 'q_a', x: 0, y: 0 }, { id: 'q_b', x: 300, y: 0 }, { id: 'q_c', x: 600, y: 0 }] })
  const moved = (m: MapView, id: string, x: number) => place(m, { [id]: { x, y: 0 } })
  it('takes each side\'s moves of different cards, even on neighbouring lines', () => {
    const r = mergeMaps(base, moved(base, 'q_a', 10), moved(base, 'q_b', 310))
    expect(r.clashes).toEqual([])
    expect(r.map.nodes!.map((n) => n.x)).toEqual([10, 310, 600])
  })
  it('keeps cards both sides added in the same gap', () => {
    const r = mergeMaps(base, place(base, { q_ab: { x: 1, y: 1 } }), place(base, { q_ac: { x: 2, y: 2 } }))
    expect(r.map.nodes!.map((n) => n.id)).toEqual(['q_a', 'q_ab', 'q_ac', 'q_b', 'q_c'])
  })
  it('keeps ours when both moved the same card, and says so', () => {
    const r = mergeMaps(base, moved(base, 'q_a', 10), moved(base, 'q_a', 20))
    expect(r.clashes).toEqual(['q_a'])
    expect(r.map.nodes![0].x).toBe(10)
  })
  it('lets a removal on one side stand', () => {
    expect(mergeMaps(base, place(base, { q_c: null }), base).map.nodes!.map((n) => n.id)).toEqual(['q_a', 'q_b'])
  })
})

describe('placing', () => {
  const m = tidyMap({ nodes: [{ id: 'q_a', x: 0, y: 0 }, { id: 'q_b', x: 100, y: 300 }, { id: 'q_c', x: 40, y: 900 }] })
  it('finds the nearest spot where a new card overlaps nothing', () => {
    const p = freeSpot(m, 10, 10)
    expect(Math.abs(p.x - 0) >= CARD_W + 16 || Math.abs(p.y - 0) >= CARD_H + 16).toBe(true)
    expect(freeSpot(m, 2000, 2000)).toEqual({ x: 2000, y: 2000 })
  })
  it('aligns and spaces cards', () => {
    expect(align(m, ['q_a', 'q_b', 'q_c'], 'left')).toEqual({ q_a: { x: 0, y: 0 }, q_b: { x: 0, y: 300 }, q_c: { x: 0, y: 900 } })
    expect(align(m, ['q_a', 'q_b', 'q_c'], 'down')).toEqual({ q_a: { x: 0, y: 0 }, q_b: { x: 100, y: 450 }, q_c: { x: 40, y: 900 } })
  })
  it('edits frames and notes by id', () => {
    const f = edit(m, 'frames', 'f_1', { label: 'Harbour', x: 0, y: 0, w: 500, h: 300, color: 2 })
    expect(edit(f, 'frames', 'f_1', { label: 'Docks' }).frames).toEqual([{ id: 'f_1', label: 'Docks', x: 0, y: 0, w: 500, h: 300, color: 2 }])
    expect(edit(f, 'frames', 'f_1', null).frames).toBeUndefined()
  })
})

describe('JSON Canvas', () => {
  const m = tidyMap({ nodes: [{ id: 'q_a', x: 0, y: 0 }, { id: 'q_b', x: 300, y: 0 }], frames: [{ id: 'f_1', label: 'Harbour', x: -20, y: -60, w: 600, h: 300, color: 3 }], notes: [{ id: 'n_1', text: 'Check the cove', x: 0, y: 400 }] })
  const text = toCanvas(m, { q_a: 'quests/q_a.md', q_b: 'quests/q_b.md' }, [{ from: 'q_a', to: 'q_b' }, { from: 'q_a', to: 'q_b', label: 'if the lens was found' }])
  it('writes groups first, quests as file nodes, one node per line', () => {
    const c = JSON.parse(text)
    expect(c.nodes.map((n: { type: string }) => n.type)).toEqual(['group', 'file', 'file', 'text'])
    expect(c.edges[1]).toMatchObject({ fromNode: 'q_a', toNode: 'q_b', label: 'if the lens was found' })
    expect(text.split('\n').filter((l) => l.includes('"type"')).length).toBe(4)
  })
  it('reads the same layout back', () => {
    expect(fromCanvas(text, { 'quests/q_a.md': 'q_a', 'quests/q_b.md': 'q_b' })).toEqual(m)
    expect(parse(writeYaml(m))).toEqual(m)
  })
})

describe('Tidy', () => {
  it('lays a chain out left to right, keeping its order, from the selection\'s corner', async () => {
    const now = new Map([['q_c', { id: 'q_c', x: 50, y: 400 }], ['q_a', { id: 'q_a', x: 100, y: 100 }], ['q_b', { id: 'q_b', x: 500, y: 900 }]])
    const at = await layered(['q_a', 'q_b', 'q_c'], [['q_a', 'q_b'], ['q_b', 'q_c']], now, { x: 50, y: 100 })
    expect(at.q_a.x).toBeLessThan(at.q_b.x)
    expect(at.q_b.x).toBeLessThan(at.q_c.x)
    expect(Math.min(at.q_a.x, at.q_b.x, at.q_c.x)).toBe(50)
    expect(Math.min(at.q_a.y, at.q_b.y, at.q_c.y)).toBe(100)
  })
})
