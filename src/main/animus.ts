// The read-only link to the game repo: scan what Animus holds, and talk to the QuestNotes Bridge addon in the Godot editor.
import { promises as fs, watch, existsSync, type FSWatcher } from 'node:fs'
import { spawn, execFileSync } from 'node:child_process'
import path from 'node:path'
import type { EngineIndex, EngineQuest } from '../shared/engine'
import { QUEST_ID } from '../shared/engine'
import type { BridgeState } from '../shared/api'

async function walk(dir: string, ext: string): Promise<string[]> {
  const out: string[] = []
  for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...(await walk(p, ext)))
    else if (e.name.endsWith(ext)) out.push(p)
  }
  return out
}

/** Quests keyed by the quest_id inside each file (Animus moves files on rename), and every engine character_id. */
export async function scan(game: string): Promise<EngineIndex> {
  const quests: Record<string, EngineQuest[]> = {}
  for (const f of (await walk(path.join(game, 'resources/quests'), '.json')).sort()) {
    try {
      const q = JSON.parse(await fs.readFile(f, 'utf8'))
      if (!QUEST_ID.test(q?.quest_id ?? '')) continue
      const stages: string[] = (q.stages ?? []).map((s: { id: string }) => s.id)
      ;(quests[q.quest_id] ??= []).push({
        path: 'res://' + path.relative(game, f).replace(/\\/g, '/'), kind: q.kind ?? 'side', title: q.title ?? q.quest_id,
        stages, stub: stages.length <= 1 && !q.roles?.length && !q.choices?.length,
      })
    } catch { /* unreadable quest files are Animus's problem to report */ }
  }
  const characters = new Set<string>()
  for (const f of await walk(path.join(game, 'resources/npc'), '.tres')) {
    const m = /character_id\s*=\s*"([^"]+)"/.exec(await fs.readFile(f, 'utf8'))
    if (m) characters.add(m[1])
  }
  return { scanned: new Date().toISOString().slice(0, 10), source: 'game', quests, characters: [...characters].sort() }
}

export function watchGame(game: string, onChange: () => void): FSWatcher | null {
  if (!existsSync(path.join(game, 'resources'))) return null
  let t: NodeJS.Timeout
  return watch(path.join(game, 'resources'), { recursive: true }, (_e, f) => {
    if (/quests|npc/.test(String(f))) { clearTimeout(t); t = setTimeout(onChange, 300) }
  })
}

/** Client of the QuestNotes Bridge addon: a token-checked WebSocket on 127.0.0.1, found through .godot/questnotes_bridge.json. */
export class Bridge {
  state: BridgeState = 'no-game'
  private ws?: WebSocket
  private seq = 0
  private waiting = new Map<number, (r: { ok: boolean; error?: string }) => void>()
  private timer?: NodeJS.Timeout
  constructor(private game: string | undefined, private onState: (s: BridgeState) => void) {
    if (game) { this.set('closed'); this.poll() }
  }
  private set(s: BridgeState) { if (s !== this.state) { this.state = s; this.onState(s) } }
  private poll = () => { this.connect().finally(() => { this.timer = setTimeout(this.poll, 3000) }) }

  private async connect() {
    if (!this.game || this.ws) return
    const info = await fs.readFile(path.join(this.game, '.godot/questnotes_bridge.json'), 'utf8').then(JSON.parse).catch(() => null)
    if (!info || !alive(info.pid)) return this.set('closed')
    const ws = new WebSocket(`ws://127.0.0.1:${info.port}/questnotes`)
    this.ws = ws
    ws.onopen = () => ws.send(JSON.stringify({ op: 'hello', token: info.token }))
    ws.onmessage = (e) => {
      const m = JSON.parse(String(e.data))
      if (m.op === 'hello' && m.ok) this.set('open')
      if (m.op === 'open') { this.waiting.get(m.id)?.(m); this.waiting.delete(m.id) }
    }
    ws.onclose = ws.onerror = () => { if (this.ws === ws) { this.ws = undefined; this.set('closed') } }
  }

  open(resPath: string, stage = ''): Promise<{ ok: boolean; error?: string }> {
    if (this.state !== 'open' || !this.ws) return Promise.resolve({ ok: false, error: 'closed' })
    const id = ++this.seq
    this.ws.send(JSON.stringify({ op: 'open', id, path: resPath, stage }))
    return new Promise((res) => {
      this.waiting.set(id, res)
      setTimeout(() => { if (this.waiting.delete(id)) res({ ok: false, error: 'timeout' }) }, 5000)
    })
  }

  /** Godot is closed: start the editor, and the addon opens the quest once the project has been scanned. */
  start(godot: string, resPath: string, stage = '') {
    spawn(godot, ['-e', '--path', this.game!, '++', `--questnotes-open=${resPath}${stage ? '#' + stage : ''}`], { detached: true, stdio: 'ignore' }).unref()
  }
  close() { clearTimeout(this.timer); this.ws?.close() }
}

const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }

export function findGodot(): string | undefined {
  for (const name of ['godot', 'godot4', 'Godot']) {
    try { return execFileSync(process.platform === 'win32' ? 'where' : 'which', [name], { encoding: 'utf8' }).split('\n')[0].trim() || undefined } catch { /* next */ }
  }
}
