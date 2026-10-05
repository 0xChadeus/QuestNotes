// Runs the QuestNotes Bridge addon in a headless Godot editor against a mock Animus tab. Needs `godot` (4.7) on PATH or $GODOT.
import { afterAll, describe, expect, it } from 'vitest'
import { chmodSync, cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { spawn, type ChildProcess } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Bridge, findGodot } from '../src/main/animus'

const godot = process.env.GODOT ?? findGodot()
const wait = async (ok: () => boolean, ms = 60000) => { for (const t = Date.now(); !ok(); await new Promise((r) => setTimeout(r, 100))) if (Date.now() - t > ms) throw new Error('timed out') }

describe.skipIf(!godot)('QuestNotes Bridge addon', () => {
  const procs: ChildProcess[] = []
  const project = () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'qn-bridge-'))
    cpSync(path.join(__dirname, 'bridge/project'), dir, { recursive: true })
    cpSync(path.join(__dirname, '../bridge/addons'), path.join(dir, 'addons'), { recursive: true })
    return dir
  }
  const log = (dir: string) => { try { return readFileSync(path.join(dir, '.godot/mock_animus_log.txt'), 'utf8') } catch { return '' } }
  afterAll(() => procs.forEach((p) => p.kill()))

  it('opens a quest and its stage in a running editor, and refuses bad requests', async () => {
    const dir = project()
    procs.push(spawn(godot!, ['--headless', '-e', '--path', dir], { stdio: 'ignore' }))
    await wait(() => existsSync(path.join(dir, '.godot/questnotes_bridge.json')))
    const states: string[] = []
    const b = new Bridge(dir, (s) => states.push(s))
    await wait(() => b.state === 'open', 15000)
    expect(await b.open('res://resources/quests/main/mq01.json', 'done')).toMatchObject({ ok: true })
    expect(await b.open('res://resources/quests/side/nope.json')).toMatchObject({ ok: false, error: 'not_found' })
    expect(await b.open('res://resources/quests/../project.godot')).toMatchObject({ ok: false, error: 'bad_path' })
    await wait(() => log(dir).includes('select'))
    expect(log(dir)).toContain('edit res://resources/quests/main/mq01.json')
    expect(log(dir)).toContain('select ["stages", 1]')
    const info = JSON.parse(readFileSync(path.join(dir, '.godot/questnotes_bridge.json'), 'utf8'))
    const ws = new WebSocket(`ws://127.0.0.1:${info.port}/questnotes`)
    const closed = await new Promise<number>((res) => { ws.onopen = () => ws.send(JSON.stringify({ op: 'hello', token: 'wrong' })); ws.onclose = (e) => res(e.code) })
    expect(closed).toBe(4003)
    b.close()
  }, 120000)

  it.skipIf(process.platform === 'win32')('starts Godot and opens the quest once the editor is ready', async () => {
    const dir = project()
    const headless = path.join(dir, 'godot-headless.sh')
    writeFileSync(headless, `#!/bin/sh\nexec "${godot}" --headless "$@"\n`)
    chmodSync(headless, 0o755)
    const b = new Bridge(dir, () => {})
    b.start(headless, 'res://resources/quests/main/mq01.json', 'meet_marcus')
    await wait(() => log(dir).includes('select'), 90000)
    expect(log(dir)).toContain('select ["stages", 0]')
    b.close()
    const pid = JSON.parse(readFileSync(path.join(dir, '.godot/questnotes_bridge.json'), 'utf8')).pid
    process.kill(pid)
  }, 120000)
})
