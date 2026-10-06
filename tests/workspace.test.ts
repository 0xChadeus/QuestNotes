// The lore folder on disk: the Trash never overwrites a page, and pages no kind uses are reported, not hidden.
import { describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Workspace } from '../src/main/workspace'
import { writePage } from '../src/shared/page'

const lore = () => { const root = mkdtempSync(path.join(tmpdir(), 'qn-ws-')); mkdirSync(path.join(root, 'quests')); return { root, ws: new Workspace(root) } }
const put = (root: string, title: string) => writeFileSync(path.join(root, 'quests/q_untitled.md'), writePage({ id: 'q_untitled', type: 'quest', title }, ''))

describe('trash', () => {
  it('keeps two trashed pages with the same name, and never restores over a live page', async () => {
    const { root, ws } = lore()
    put(root, 'Alpha')
    expect(await ws.trash('quests/q_untitled.md')).toBe('quests/q_untitled.md')
    put(root, 'Gamma')
    expect(await ws.trash('quests/q_untitled.md')).toBe('quests/q_untitled~2.md')
    expect((await ws.trashed()).map((p) => p.data.title).sort()).toEqual(['Alpha', 'Gamma'])
    await ws.restore('quests/q_untitled~2.md')
    expect(readFileSync(path.join(root, 'quests/q_untitled.md'), 'utf8')).toContain('Gamma')
    await expect(ws.restore('quests/q_untitled.md')).rejects.toThrow(/already exists/)
    expect(existsSync(path.join(root, 'trash/quests/q_untitled.md'))).toBe(true)
  })
  it('reports pages in a folder no kind uses', async () => {
    const { root, ws } = lore()
    mkdirSync(path.join(root, 'districts'))
    writeFileSync(path.join(root, 'districts/di_a.md'), writePage({ id: 'di_a', type: 'district', title: 'A' }, ''))
    await ws.loadConfig()
    expect((await ws.loadAll()).errors).toEqual([{ file: 'districts/', error: expect.stringMatching(/1 page is hidden: no kind .* uses the folder “districts”/) }])
  })
})

describe('watching', () => {
  it('keeps seeing a page changed by someone else after this app has saved it', async () => {
    const { root, ws } = lore()
    put(root, 'Alpha')
    await ws.loadConfig()
    const seen: string[] = []
    ws.watch((_f, p) => p && seen.push(p.data.title))
    await new Promise((r) => setTimeout(r, 100))
    await ws.writeText('quests/q_untitled.md', writePage({ id: 'q_untitled', type: 'quest', title: 'Ours' }, ''))
    await new Promise((r) => setTimeout(r, 300))
    put(root, 'Theirs')
    await expect.poll(() => seen, { timeout: 3000 }).toEqual(['Theirs'])
    ws.close()
  })
})

describe('reading pages', () => {
  it('opens a folder whose pages lack a title, id or type, and creates no folders to watch it', async () => {
    const { root, ws } = lore()
    writeFileSync(path.join(root, 'quests/q_untitled.md'), '---\ntype: quest\nstatus: idea\n---\n')
    mkdirSync(path.join(root, 'acts'))
    writeFileSync(path.join(root, 'acts/act_untitled.md'), '---\norder: 2\n---\n')
    await ws.loadConfig()
    const { pages, errors } = await ws.loadAll()
    expect(errors).toEqual([])
    expect(pages.map((p) => [p.data.id, p.data.type, p.data.title]).sort()).toEqual([['act_untitled', 'act', ''], ['q_untitled', 'quest', '']])
    const seen: string[] = []
    ws.watch((f) => seen.push(f))
    expect(existsSync(path.join(root, 'characters'))).toBe(false)
    await new Promise((r) => setTimeout(r, 100))
    mkdirSync(path.join(root, 'characters'))
    await new Promise((r) => setTimeout(r, 100))
    writeFileSync(path.join(root, 'characters/ch_a.md'), writePage({ id: 'ch_a', type: 'character', title: 'A' }, ''))
    await expect.poll(() => seen, { timeout: 3000 }).toEqual(['characters/ch_a.md'])
    ws.close()
  })
})
