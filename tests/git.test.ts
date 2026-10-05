// Two designers sync one lore repo through a shared remote: neighbouring edits merge, same-field edits come back to choose.
import { beforeAll, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { exec } from 'dugite'
import * as git from '../src/main/git'
import { writePage } from '../src/shared/page'
import { resolve } from '../src/shared/merge'

const page = (status: string, rows: string[]) => writePage({ id: 'q_mq02', type: 'quest', title: 'Night Life', status },
  `## Branching surfaces\n\n| Branch condition | Outcome | Pays off in |\n| --- | --- | --- |\n${rows.map((r) => `| ${r} | o |  |`).join('\n')}\n`)

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
    write(alice, page('draft', ['Reports to Marcus', 'Keeps it quiet', 'Finds the blood trail']))
    await git.init(alice)
    await git.setRemote(alice, remote)
    expect(await git.sync(alice)).toEqual({})
    await exec(['clone', remote, bob], tmp)
  })

  it('merges edits to neighbouring table rows without asking', async () => {
    write(alice, page('draft', ['Reports to Marcus at once', 'Keeps it quiet', 'Finds the blood trail']))
    write(bob, page('draft', ['Reports to Marcus', 'Keeps it between Ed and Lyra', 'Finds the blood trail']))
    expect(await git.sync(alice)).toEqual({})
    expect(await git.sync(bob)).toEqual({})
    expect(await git.sync(alice)).toEqual({})
    for (const who of [alice, bob]) expect(readFileSync(file(who), 'utf8')).toBe(page('draft', ['Reports to Marcus at once', 'Keeps it between Ed and Lyra', 'Finds the blood trail']))
  })

  it('returns same-field edits for the designer to choose', async () => {
    write(alice, page('review', ['Reports to Marcus at once', 'Keeps it between Ed and Lyra', 'Finds the blood trail']))
    write(bob, page('ready', ['Reports to Marcus at once', 'Keeps it between Ed and Lyra', 'Finds the blood trail']))
    await git.sync(alice)
    const r = await git.sync(bob)
    expect(r.conflicts?.[0].conflicts).toEqual([{ base: 'status: draft', ours: 'status: ready', theirs: 'status: review' }])
    const f = r.conflicts![0]
    expect(await git.finish(bob, [{ file: f.file, text: resolve(f.merged, f.conflicts, [true]) }])).toEqual({})
    expect(readFileSync(file(bob), 'utf8')).toContain('status: review')
    expect((await git.status(bob)).merging).toBe(false)
  })
})
