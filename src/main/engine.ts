// The read-only link to a game project: scan its quest and character files as the project's engine config describes them,
// and talk to the QuestNotes Bridge addon in a running Godot editor.
import { promises as fs, watch, existsSync, readdirSync, type FSWatcher } from 'node:fs'
import { spawn, execFileSync } from 'node:child_process'
import path from 'node:path'
import type { EngineConfig, EngineIndex, EngineQuest } from '../shared/engine'
import type { BridgeState } from '../shared/api'

/** Files under `root` matching a glob such as "resources/quests/**\/*.json". */
export async function glob(root: string, pattern: string): Promise<string[]> {
  const parts = pattern.split('/')
  const base = parts.slice(0, parts.findIndex((p) => p.includes('*'))).join('/')
  const re = new RegExp(`^${pattern.split('**/').map((s) => s.split('*').map((x) => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')).join('(?:.*/)?')}$`)
  const out: string[] = []
  const walk = async (dir: string) => {
    for (const e of await fs.readdir(path.join(root, dir), { withFileTypes: true }).catch(() => [])) {
      const rel = dir ? `${dir}/${e.name}` : e.name
      if (e.isDirectory()) await walk(rel)
      else if (re.test(rel)) out.push(rel)
    }
  }
  await walk(base)
  return out.sort()
}
const at = (o: any, key?: string) => (key ? key.split('.').reduce((v, k) => v?.[k], o) : undefined)

/** Quests keyed by the id inside each file (an engine may move files when a quest is renamed), and every character id. */
export async function scan(game: string, e: EngineConfig): Promise<EngineIndex> {
  const quests: Record<string, EngineQuest[]> = {}
  const q = e.quests
  const valid = new RegExp(q?.id_pattern ?? '.+')
  for (const rel of q ? await glob(game, q.files) : []) {
    try {
      const data = JSON.parse(await fs.readFile(path.join(game, rel), 'utf8'))
      const id = String(at(data, q!.id ?? 'id') ?? '')
      if (!valid.test(id)) continue
      const stages: string[] = (at(data, q!.stages) ?? []).map((s: any) => String(at(s, q!.stage_id ?? 'id')))
      ;(quests[id] ??= []).push({ path: (e.res_prefix ?? '') + rel, kind: String(at(data, q!.kind) ?? ''), title: String(at(data, q!.title) ?? id), stages, stub: stages.length <= 1 })
    } catch { /* an unreadable quest file is the engine's problem to report */ }
  }
  const characters = new Set<string>()
  const c = e.characters
  for (const rel of c ? await glob(game, c.files) : []) {
    const m = new RegExp(c!.id_pattern).exec(await fs.readFile(path.join(game, rel), 'utf8'))
    if (m) characters.add(m[1] ?? m[0])
  }
  return { scanned: new Date().toISOString().slice(0, 10), source: 'game', quests, characters: [...characters].sort() }
}

export function watchGame(game: string, e: EngineConfig, onChange: () => void) {
  const dirs = [e.quests?.files, e.characters?.files].filter(Boolean).map((g) => path.join(game, g!.split('/*')[0]))
  return dirs.filter((d) => existsSync(d)).map((d) => watchTree(d, onChange))
}

/** Watches a folder and every folder below it, one watcher each (see Workspace.watch for why not `recursive`), adding new folders as they appear. */
export function watchTree(dir: string, onChange: () => void) {
  const all = new Map<string, FSWatcher>()
  let t: NodeJS.Timeout
  const fire = () => { clearTimeout(t); t = setTimeout(() => { add(dir); onChange() }, 300) }
  const add = (d: string) => {
    if (!all.has(d)) try { all.set(d, watch(d, fire).on('error', () => { all.get(d)?.close(); all.delete(d) })) } catch { return }
    try { for (const x of readdirSync(d, { withFileTypes: true })) if (x.isDirectory()) add(path.join(d, x.name)) } catch { /* gone */ }
  }
  add(dir)
  return { close: () => all.forEach((w) => w.close()) }
}

/** Client of the QuestNotes Bridge addon: a token-checked WebSocket on 127.0.0.1, found through .godot/questnotes_bridge.json. */
export class Bridge {
  state: BridgeState = 'no-game'
  private ws?: WebSocket
  private seq = 0
  private waiting = new Map<number, (r: { ok: boolean; error?: string }) => void>()
  private timer?: NodeJS.Timeout
  constructor(private game: string | undefined, private onState: (s: BridgeState) => void, private adapter = '') {
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
    ws.onmessage = (m) => {
      const msg = JSON.parse(String(m.data))
      if (msg.op === 'hello' && msg.ok) this.set('open')
      if (msg.op === 'open') { this.waiting.get(msg.id)?.(msg); this.waiting.delete(msg.id) }
    }
    ws.onclose = ws.onerror = () => { if (this.ws === ws) { this.ws = undefined; this.set('closed') } }
  }

  open(resPath: string, stage = ''): Promise<{ ok: boolean; error?: string }> {
    if (this.state !== 'open' || !this.ws) return Promise.resolve({ ok: false, error: 'closed' })
    const id = ++this.seq
    this.ws.send(JSON.stringify({ op: 'open', id, path: resPath, stage, adapter: this.adapter }))
    return new Promise((res) => {
      this.waiting.set(id, res)
      setTimeout(() => { if (this.waiting.delete(id)) res({ ok: false, error: 'timeout' }) }, 5000)
    })
  }

  /** Godot is closed: start the editor, and the addon opens the quest once the project has been scanned. */
  start(godot: string, resPath: string, stage = '') {
    const args = ['-e', '--path', this.game!, '++', `--questnotes-open=${resPath}${stage ? '#' + stage : ''}`, ...(this.adapter ? [`--questnotes-adapter=${this.adapter}`] : [])]
    spawn(godot, args, { detached: true, stdio: 'ignore' }).unref()
  }
  close() { clearTimeout(this.timer); this.ws?.close() }
}

const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }

export function findGodot(): string | undefined {
  for (const name of ['godot', 'godot4', 'Godot']) {
    try { return execFileSync(process.platform === 'win32' ? 'where' : 'which', [name], { encoding: 'utf8' }).split('\n')[0].trim() || undefined } catch { /* next */ }
  }
}
