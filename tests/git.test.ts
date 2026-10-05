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
})
