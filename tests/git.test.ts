// Two designers sync one lore repo through a shared remote: neighbouring edits merge, same-field edits come back to choose.
import { beforeAll, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { exec } from 'dugite'
import * as git from '../src/main/git'
import { writePage } from '../src/shared/page'
import { resolve } from '../src/shared/merge'

const page = (status: string, rows: string[]) => writePage({ id: 'q_mq02', type: 'quest', title: 'Night Tide', status },
  `## Branches\n\n| Condition | Outcome | Pays off in |\n| --- | --- | --- |\n${rows.map((r) => `| ${r} | o |  |`).join('\n')}\n`)

describe('sync', () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'qn-git-'))
  const remote = path.join(tmp, 'remote.git'), alice = path.join(tmp, 'alice'), bob = path.join(tmp, 'bob')
  const file = (who: string) => path.join(who, 'quests/q_mq02.md')
  const write = (who: string, text: string) => writeFileSync(file(who), text)
  beforeAll(async () => {
    Object.assign(process.env, { GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com' })
    await exec(['init', '--bare', '-b', 'main', remote], tmp)
    mkdirSync(path.join(alice, 'quests'), { recursive: true })
    writeFileSync(path.join(alice, '.gitattributes'), '* text=auto eol=lf\n')
    write(alice, page('draft', ['Tells the Guild', 'Keeps it quiet', 'Finds the cut ropes']))
    await git.init(alice)
    await git.setRemote(alice, remote)
    expect(await git.sync(alice)).toEqual({})
    await exec(['clone', remote, bob], tmp)
  })

  it('merges edits to neighbouring table rows without asking', async () => {
    write(alice, page('draft', ['Tells the Guild at once', 'Keeps it quiet', 'Finds the cut ropes']))
    write(bob, page('draft', ['Tells the Guild', 'Keeps it between Mara and the player', 'Finds the cut ropes']))
    expect(await git.sync(alice)).toEqual({})
    expect(await git.sync(bob)).toEqual({})
    expect(await git.sync(alice)).toEqual({})
    for (const who of [alice, bob]) expect(readFileSync(file(who), 'utf8')).toBe(page('draft', ['Tells the Guild at once', 'Keeps it between Mara and the player', 'Finds the cut ropes']))
  })

  it('returns same-field edits for the designer to choose', async () => {
    write(alice, page('review', ['Tells the Guild at once', 'Keeps it between Mara and the player', 'Finds the cut ropes']))
    write(bob, page('ready', ['Tells the Guild at once', 'Keeps it between Mara and the player', 'Finds the cut ropes']))
    await git.sync(alice)
    const r = await git.sync(bob)
    expect(r.conflicts?.[0].conflicts).toEqual([{ base: 'status: draft', ours: 'status: ready', theirs: 'status: review' }])
    const f = r.conflicts![0]
    expect(await git.finish(bob, [{ file: f.file, text: resolve(f.merged, f.conflicts, [true]) }])).toEqual({})
    expect(readFileSync(file(bob), 'utf8')).toContain('status: review')
    expect((await git.status(bob)).merging).toBe(false)
  })
  it('explains a failed sync and does not call the folder up to date', async () => {
    const lone = path.join(tmp, 'lone')
    mkdirSync(path.join(lone, 'quests'), { recursive: true })
    write(lone, page('draft', ['A']))
    await git.init(lone)
    await git.setRemote(lone, path.join(tmp, 'nowhere.git'))
    expect((await git.sync(lone)).error).toMatch(/^Could not reach the shared copy\. Check the remote URL in Settings\./)
    expect(await git.status(lone)).toMatchObject({ remote: true, upstream: false })
    await git.setRemote(lone, '')
    expect((await git.status(lone)).remote).toBe(false)
  })
  it('merges two designers\' map moves card by card, even on neighbouring lines', async () => {
    const map = (who: string, nodes: [string, number][]) => {
      mkdirSync(path.join(who, 'views'), { recursive: true })
      writeFileSync(path.join(who, 'views/map.yaml'), `version: 2\nnodes:\n${nodes.map(([id, x]) => `  - {id: ${id}, x: ${x}, y: 0}`).join('\n')}\n`)
    }
    map(alice, [['q_a', 0], ['q_b', 300], ['q_c', 600]])
    expect(await git.sync(alice)).toEqual({})
    expect(await git.sync(bob)).toEqual({})
    map(alice, [['q_a', 40], ['q_b', 300], ['q_c', 600]])
    map(bob, [['q_a', 0], ['q_b', 340], ['q_c', 600], ['q_d', 900]])
    expect(await git.sync(alice)).toEqual({})
    expect(await git.sync(bob)).toEqual({})
    expect(await git.sync(alice)).toEqual({})
    for (const who of [alice, bob]) expect(readFileSync(path.join(who, 'views/map.yaml'), 'utf8')).toBe('version: 2\nnodes:\n  - {id: q_a, x: 40, y: 0}\n  - {id: q_b, x: 340, y: 0}\n  - {id: q_c, x: 600, y: 0}\n  - {id: q_d, x: 900, y: 0}\n')
    map(alice, [['q_a', 80], ['q_b', 340], ['q_c', 600], ['q_d', 900]])
    map(bob, [['q_a', 120], ['q_b', 340], ['q_c', 600], ['q_d', 900]])
    await git.sync(alice)
    expect((await git.sync(bob)).notes).toEqual(['You and someone else both moved 1 item on the map; your positions were kept.'])
  })
})
