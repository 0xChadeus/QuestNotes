import { app, BrowserWindow, dialog, ipcMain, Menu, shell, type IpcMainInvokeEvent } from 'electron'
import { autoUpdater } from 'electron-updater'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import type { FSWatcher } from 'node:fs'
import { Workspace } from './workspace'
import * as git from './git'
import * as settings from './settings'
import { Bridge, findGodot, scan, watchGame } from './engine'
import { describe, importDocs, suggest } from './importer'
import type { EngineIndex } from '../shared/engine'
import type { Events, Invoke, Project } from '../shared/api'

let win: BrowserWindow | undefined
let ws: Workspace | undefined
let bridge: Bridge | undefined
let gameWatch: FSWatcher[] = []
let engine: EngineIndex | null = null
let docs: { name: string; data: Uint8Array }[] = []
const SNAPSHOT = 'engine/index.yaml'

const send = <K extends keyof Events>(event: K, ...args: Parameters<Events[K]>) => win?.webContents.send(event, ...args)
const trusted = (e: IpcMainInvokeEvent) => {
  const url = e.senderFrame?.url ?? ''
  return process.env.ELECTRON_RENDERER_URL ? url.startsWith(process.env.ELECTRON_RENDERER_URL) : url.startsWith('file://')
}
function handle<K extends keyof Invoke>(channel: K, fn: (...args: Parameters<Invoke[K]>) => ReturnType<Invoke[K]> | Promise<ReturnType<Invoke[K]>>) {
  ipcMain.handle(channel, (e, ...args) => {
    if (!trusted(e)) throw new Error('untrusted sender')
    return fn(...(args as Parameters<Invoke[K]>))
  })
}
const need = () => { if (!ws) throw new Error('no project open'); return ws }

async function connectGame(game: string | undefined) {
  gameWatch.forEach((w) => w.close()); bridge?.close()
  const e = need().schema.engine
  bridge = new Bridge(e ? game : undefined, (s) => send('bridge:state', s), e?.adapter)
  engine = null
  if (!e) return
  if (!game) { engine = (await need().readYaml(SNAPSHOT)) ?? null; if (engine) engine.source = 'snapshot'; return }
  const rescan = async () => {
    engine = await scan(game, e)
    const snap = await need().readYaml(SNAPSHOT)
    const same = (a: EngineIndex | null) => JSON.stringify([a?.quests, a?.characters])
    if (same(snap) !== same(engine)) await need().writeYaml(SNAPSHOT, { ...engine, source: undefined })
    send('engine:index', engine)
  }
  await rescan()
  gameWatch = watchGame(game, e, rescan)
}

async function openProject(root: string): Promise<Project> {
  ws?.close()
  ws = new Workspace(root)
  settings.remember(root)
  await ws.loadConfig()
  const { pages, errors } = await ws.loadAll()
  ws.watch((file, page) => send('page:changed', file, page))
  const s = settings.load()
  await connectGame(s.games[root])
  for (const p of pages) for (const w of p.data.title.split(/[\s,.’'-]+/)) if (w.length > 2) win?.webContents.session.addWordToSpellCheckerDictionary(w)
  return {
    root, config: ws.config, pages, errors, map: (await ws.readYaml('views/map.yaml')) ?? {}, git: await git.status(root),
    engine, bridge: bridge!.state, game: s.games[root], godot: s.godot ?? findGodot(), issues: (await ws.readYaml('views/issues.yaml'))?.open ?? [],
  }
}

const pick = async (title: string, props: ('openDirectory' | 'openFile' | 'multiSelections' | 'createDirectory')[], filters?: Electron.FileFilter[]) =>
  (await dialog.showOpenDialog(win!, { title, properties: props, filters })).filePaths

handle('app:recent', () => settings.load().recent)
handle('app:pickFolder', async (title) => (await pick(title, ['openDirectory', 'createDirectory']))[0] ?? null)
handle('project:create', async (root, name) => { await Workspace.create(root, name); await git.init(root).catch(() => {}); return openProject(root) })
handle('project:open', openProject)
handle('page:write', (p) => need().write(p))
handle('page:trash', (f) => need().trash(f))
handle('page:restore', (f) => need().restore(f))
handle('trash:list', () => need().trashed())
handle('trash:empty', () => need().emptyTrash())
handle('view:write', (name, view) => need().writeYaml(`views/${name}.yaml`, view))
handle('git:status', () => git.status(need().root))
handle('git:init', async () => { await git.init(need().root); return git.status(need().root) })
handle('git:sync', () => git.sync(need().root))
handle('git:finish', (resolved) => git.finish(need().root, resolved))
handle('git:history', (file, since) => git.history(need().root, file, since))
handle('git:setRemote', (url) => git.setRemote(need().root, url))
handle('project:saveConfig', async (config) => { await need().saveConfig(config); return openProject(need().root) })
handle('engine:pickGame', async () => {
  const game = (await pick('Choose the game folder', ['openDirectory']))[0]
  if (game) { settings.update((s) => { s.games[need().root] = game }); await connectGame(game) }
  return { game, engine }
})
handle('engine:pickGodot', async () => {
  const godot = (await pick('Choose the Godot executable', ['openFile']))[0] ?? null
  if (godot) settings.update((s) => { s.godot = godot })
  return godot
})
handle('engine:open', async (target, stage) => {
  if (bridge?.state === 'open') return bridge.open(target, stage)
  const godot = settings.load().godot ?? findGodot()
  if (!bridge || bridge.state === 'no-game') return { ok: false, error: 'no-game' }
  if (!godot) return { ok: false, error: 'no-godot' }
  bridge.start(godot, target, stage)
  return { ok: true, started: true }
})
handle('import:pick', async () => {
  const paths = await pick('Choose the design documents', ['openFile', 'multiSelections'], [{ name: 'Word documents', extensions: ['docx'] }])
  docs = await Promise.all(paths.map(async (p) => ({ name: path.basename(p), data: new Uint8Array(await readFile(p)) })))
  const saved = need().config.import?.filter((j) => docs.some((d) => d.name === j.file))
  return { files: describe(docs), suggested: saved?.length ? saved : suggest(docs, need().schema) }
})
handle('import:preview', async (jobs) => importDocs(docs, jobs, need().schema, (await need().loadAll()).pages))
handle('import:commit', async (pages, jobs) => {
  for (const p of pages) await need().write(p)
  const keep = (need().config.import ?? []).filter((j) => !jobs.some((k) => k.file === j.file))
  await need().saveConfig({ ...need().config, import: [...keep, ...jobs] })
  docs = []
  return need().config
})
handle('shell:open', async (file) => { await shell.openPath(need().abs(file)) })
handle('shell:addon', async () => { await shell.openPath(path.join(app.isPackaged ? process.resourcesPath : app.getAppPath(), 'bridge/addons')) })

function createWindow() {
  win = new BrowserWindow({
    width: 1480, height: 920, minWidth: 980, minHeight: 600, show: false, backgroundColor: '#f3eee3', title: 'QuestNotes',
    webPreferences: { preload: path.join(__dirname, '../preload/index.js'), sandbox: true, contextIsolation: true, spellcheck: true },
  })
  win.once('ready-to-show', () => win!.show())
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' } })
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  win.webContents.on('context-menu', (_e, p) => {
    const fixes = p.dictionarySuggestions.map((s) => ({ label: s, click: () => win!.webContents.replaceMisspelling(s) }))
    const learn = p.misspelledWord ? [{ label: `Add “${p.misspelledWord}” to dictionary`, click: () => win!.webContents.session.addWordToSpellCheckerDictionary(p.misspelledWord) }, { type: 'separator' as const }] : []
    Menu.buildFromTemplate([...fixes, ...(fixes.length ? [{ type: 'separator' as const }] : []), ...learn, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }]).popup()
  })
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(path.join(__dirname, '../renderer/index.html'))
}

// One window per user: launching again (from the dock, say) brings the open window forward.
if (!app.requestSingleInstanceLock()) app.quit()
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus() } })

app.whenReady().then(() => {
  Menu.setApplicationMenu(process.platform === 'darwin' ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]) : null)
  createWindow()
  if (app.isPackaged && existsSync(path.join(process.resourcesPath, 'app-update.yml'))) autoUpdater.checkForUpdatesAndNotify().catch(() => {})
})
app.on('window-all-closed', () => { ws?.close(); bridge?.close(); gameWatch.forEach((w) => w.close()); app.quit() })
