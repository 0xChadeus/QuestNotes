import { useEffect, useMemo, useRef, useState } from 'react'
import MiniSearch from 'minisearch'
import { useStore, go, peek, openFull, createPage, createQuest, walk, loadProject, toast, undo, redo, flushAll, goBack, goForward, showOnMap, duplicate, trashPage, type View } from './store'
import { call } from './api'
import { kindLabel, label } from './derive'
import { copy, rename } from './ui'
import { placeAll, exportCanvas, importCanvas } from './MapView'
import { normalizeBodies } from './Editor'
import { DEFAULT_CONFIG, type ImportJob, type ProjectConfig } from '../../shared/schema'
import { ENGINE_PRESETS, opensInEditor } from '../../shared/engine'
import { writeYaml } from '../../shared/page'
import { resolve } from '../../shared/merge'
import type { FileConflict, ImportFile, ImportResult } from '../../shared/api'
import { parse } from 'yaml'

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`
// A dialog with unsaved work sets `guard`, which may ask before the dialog is dismissed.
let guard: (() => boolean) | null = null
const close = () => { guard = null; useStore.setState({ dialog: null, palette: false }) }
/** Escape, ×, or a click beside the dialog: asks first when the dialog holds unsaved work. */
export const closeDialog = () => { if (!guard || guard()) close() }
const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), textarea, select, a[href]'
function Modal({ title, children, wide }: { title: string; children: React.ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { if (!ref.current?.contains(document.activeElement)) ref.current?.querySelector<HTMLElement>('input, textarea, select, button.primary')?.focus() }, [])
  /** Tab and Shift+Tab stay inside the dialog. */
  const trap = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab') return
    const f = [...ref.current!.querySelectorAll<HTMLElement>(FOCUSABLE)], first = f[0], last = f[f.length - 1]
    if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault() } else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault() }
  }
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && closeDialog()}>
      <div className={`modal${wide ? ' wide' : ''}`} ref={ref} role="dialog" aria-label={title} onKeyDown={trap}><header><h3>{title}</h3><button className="x" title="Close (Esc)" onClick={closeDialog}>×</button></header>{children}</div>
    </div>
  )
}

export const newQuest = async () => peek(await createQuest({ status: 'idea' }))
export async function sync() {
  await flushAll()
  toast('Syncing…', undefined, 'sync')
  const r = await call('git:sync')
  if (r.conflicts?.length) { useStore.setState({ dialog: 'sync', conflicts: r.conflicts }); return }
  useStore.setState({ git: await call('git:status') })
  if (r.error) toast(r.error, { label: 'Settings', run: () => useStore.setState({ dialog: 'settings' }) }, 'sync')
  else toast(['Synced.', ...(r.notes ?? [])].join(' '), undefined, 'sync')
}
const goto = (v: View) => () => go(v)
/** The page the designer is looking at: the full page, else the top of the side panel, else the selected card. */
export const current = () => { const s = useStore.getState(); const id = s.full ?? s.peek[s.peek.length - 1] ?? s.selected; return id && s.pages[id] ? id : null }
export const saveNow = async () => { await flushAll(); useStore.setState({ saved: Date.now() }) }

function commands(): { label: string; key?: string; run: () => void }[] {
  const s = useStore.getState().schema
  const id = current(), page = id ? useStore.getState().pages[id] : undefined
  return [
    { label: 'New quest', key: 'N', run: newQuest },
    ...(page ? [
      { label: `Rename “${page.data.title}”`, key: 'F2', run: () => rename(id!) },
      { label: `Duplicate “${page.data.title}”`, key: 'Ctrl D', run: () => duplicate(id!) },
      ...(page.data.type === 'quest' ? [{ label: `Show “${page.data.title}” on the map`, run: () => showOnMap(id!) }] : []),
      { label: `Copy a link to “${page.data.title}”`, run: () => copy(`[[${id}]]`) },
      { label: `Move “${page.data.title}” to the Trash`, key: 'Del', run: () => trashPage(id!) },
    ] : []),
    { label: 'Undo', key: 'Ctrl Z', run: () => undo() }, { label: 'Redo', key: 'Ctrl Shift Z', run: redo },
    { label: 'Save now', key: 'Ctrl S', run: saveNow },
    { label: 'Go back', key: 'Alt ←', run: goBack }, { label: 'Go forward', key: 'Alt →', run: goForward },
    { label: 'Go to the map', key: 'G M', run: goto('map') },
    ...(s.matrix ? [{ label: `Go to the ${s.matrix.title.toLowerCase()}`, key: 'G X', run: goto('matrix') }] : []),
    { label: 'Go to the cast', key: 'G C', run: goto('cast') }, { label: 'Go to handoff', key: 'G H', run: goto('handoff') },
    { label: 'Go to issues', key: 'G I', run: goto('issues') },
    { label: 'Show or hide payoff edges', key: 'P', run: () => useStore.setState({ payoffs: !useStore.getState().payoffs }) },
    { label: 'Fit everything on the map', key: 'Shift 1', run: () => window.dispatchEvent(new Event('qn:fit')) },
    { label: 'Fit the selection', key: 'Shift 2', run: () => window.dispatchEvent(new CustomEvent('qn:fit', { detail: 'selection' })) },
    { label: 'Next quest along the links', key: ']', run: () => walk(1) }, { label: 'Previous quest along the links', key: '[', run: () => walk(-1) },
    { label: 'Tidy the selected quests', run: () => window.dispatchEvent(new Event('qn:tidy')) },
    { label: 'Frame the selected quests', key: 'Ctrl G', run: () => window.dispatchEvent(new Event('qn:frame')) },
    { label: 'Place all hooks on the map', run: placeAll },
    { label: 'Export the map as JSON Canvas', run: exportCanvas }, { label: 'Import a JSON Canvas layout', run: importCanvas },
    { label: 'Clear map filters', run: () => useStore.setState({ filters: [], text: '' }) },
    { label: 'Import design documents', run: () => useStore.setState({ dialog: 'import' }) },
    { label: 'Sync', run: sync },
    { label: 'Settings', run: () => useStore.setState({ dialog: 'settings' }) },
    { label: 'Project settings', run: () => useStore.setState({ dialog: 'project' }) },
    { label: 'Open the lore folder', run: () => call('shell:open', '') },
    { label: 'Keyboard shortcuts', key: '?', run: () => useStore.setState({ dialog: 'shortcuts' }) },
    { label: 'Open the Trash', run: goto('trash') },
    ...s.kinds.filter((k) => k.id !== 'quest').map((k) => ({ label: `New ${k.label.toLowerCase()}`, run: async () => peek(await createPage(k.id, '')) })),
    { label: 'Switch project', run: switchProject },
  ]
}
export const switchProject = async () => { await flushAll(); useStore.setState({ project: undefined, pages: {}, peek: [], full: null, dialog: null }) }

/** A one-line question, such as a new name. Enter confirms, Escape cancels. */
export function AskDialog() {
  const a = useStore((s) => s.ask)!
  const [v, setV] = useState(a.value)
  const ok = () => { if (v.trim()) { close(); a.run(v.trim()) } }
  return (
    <Modal title={a.title}>
      <input className="ask" autoFocus value={v} placeholder={a.placeholder} onFocus={(e) => e.target.select()} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ok()} />
      <div className="actions"><button onClick={close}>Cancel</button><button className="primary" disabled={!v.trim()} onClick={ok}>{a.ok}</button></div>
    </Modal>
  )
}

export function Palette() {
  const { pages, recent, schema } = useStore()
  const [q, setQ] = useState('')
  const [i, setI] = useState(0)
  const index = useMemo(() => {
    const ms = new MiniSearch({ fields: ['code', 'title', 'aliases', 'text'], searchOptions: { prefix: true, fuzzy: 0.2, boost: { code: 4, title: 3, aliases: 2 } } })
    ms.addAll(Object.values(pages).map((p) => ({ id: p.data.id, code: p.data.code ?? '', title: p.data.title, aliases: (p.data.aliases ?? []).join(' '), text: p.body })))
    return ms
  }, [pages])
  // Commands whose words begin with what was typed ("new act", "set") come before pages, unless a page's title begins with it.
  const ql = q.toLowerCase().trim(), words = ql.split(/\s+/)
  const strong = (l: string) => { const lw = l.toLowerCase().split(/[\s“”]+/); return !!ql && words.every((w) => lw.some((x) => x.startsWith(w))) }
  const all = commands()
  const cmds = ql ? all.filter((c) => c.label.toLowerCase().includes(ql) || strong(c.label)) : all.slice(0, 8)
  const found = (ql ? index.search(q).map((r) => String(r.id)) : recent).filter((id) => pages[id]).slice(0, 10)
  const titled = found.some((id) => `${pages[id].data.code ?? ''} ${pages[id].data.title}`.toLowerCase().trim().startsWith(ql) || pages[id].data.title.toLowerCase().startsWith(ql))
  const first = titled ? [] : cmds.filter((c) => strong(c.label)).slice(0, 6)
  const asPage = (id: string) => ({ key: id, label: label(pages, id), hint: kindLabel(schema, pages[id].data.type), run: (side: boolean) => (side ? peek(id) : openFull(id)) })
  const asCmd = (c: (typeof all)[number]) => ({ key: c.label, label: c.label, hint: c.key ?? '', run: () => c.run() })
  const items = [...first.map(asCmd), ...found.slice(0, first.length ? 6 : 10).map(asPage), ...cmds.filter((c) => !first.includes(c)).slice(0, ql ? 6 : 8).map(asCmd)]
  const run = (n: number, side = false) => { close(); items[n]?.run(side) }
  return (
    <div className="overlay top" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="palette">
        <input autoFocus value={q} placeholder="Find a page or run a command…" onChange={(e) => { setQ(e.target.value); setI(0) }} onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { setI(Math.min(i + 1, items.length - 1)); e.preventDefault() }
          if (e.key === 'ArrowUp') { setI(Math.max(i - 1, 0)); e.preventDefault() }
          if (e.key === 'Enter') run(i, e.shiftKey)
          if (e.key === 'Escape') { e.stopPropagation(); close() }
        }} />
        <ul>{items.map((it, n) => <li key={it.key} className={n === i ? 'on' : ''} onMouseDown={(e) => run(n, e.shiftKey)}>{it.label}<kbd>{it.hint}</kbd></li>)}</ul>
        <footer>Enter opens · Shift Enter opens beside · {found.length ? '' : q ? 'No page matches. ' : 'Recent pages appear here.'}</footer>
      </div>
    </div>
  )
}

/** Design documents become pages through import jobs: which file, which headings, which kind of page. They are saved in questnotes.yaml. */
export function ImportDialog() {
  const schema = useStore((s) => s.schema)
  const [files, setFiles] = useState<ImportFile[] | null>(null)
  const [jobs, setJobs] = useState('')
  const [r, setR] = useState<ImportResult | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { guard = () => !files || confirm('Close the import? Nothing has been imported yet.') }, [files])
  const parsed = (): ImportJob[] | null => { try { setError(''); return parse(jobs) ?? [] } catch (e) { setError(String(e)); return null } }
  const pick = async () => { const x = await call('import:pick'); if (x.files.length) { setFiles(x.files); setJobs(writeYaml(x.suggested)); setR(null) } }
  const preview = async () => { const j = parsed(); if (j) { setBusy(true); try { setR(await call('import:preview', j)) } catch (e) { setError(String(e)) } setBusy(false) } }
  const commit = async () => {
    setBusy(true)
    const pages = normalizeBodies(r!.pages)
    const config = await call('import:commit', pages, parsed() ?? [])
    const s = useStore.getState()
    const issues = [...s.issues, ...r!.issues.filter((x) => !s.issues.includes(x))]
    useStore.setState({ pages: { ...s.pages, ...Object.fromEntries(pages.map((p) => [p.data.id, p])) }, issues, project: { ...s.project!, config } })
    await call('view:write', 'issues', { open: issues })
    close(); go('map'); toast(`Imported ${plural(pages.length, 'page')}`)
  }
  return (
    <Modal title="Bring in design documents" wide>
      {!files ? <><p>Choose .docx files. QuestNotes suggests how each becomes pages; you can adjust that before anything is written.</p>
        <button className="primary" onClick={pick}>Choose .docx files…</button></>
        : !r ? <>
          <div className="import-cols">
            <div><h4>Documents</h4>{files.map((f) => <details key={f.name} open={files.length === 1}><summary>{f.name}</summary><pre className="outline">{f.outline}</pre></details>)}</div>
            <div><h4>Import jobs</h4><textarea className="yaml" value={jobs} onChange={(e) => setJobs(e.target.value)} spellCheck={false} rows={18} />
              <p className="muted small">One job per kind of page. <code>file</code> and <code>kind</code> ({schema.kinds.map((k) => k.id).join(', ')}); then <code>level</code> (heading level),
                {' '}<code>under</code> (only below this heading), <code>match</code> / <code>skip</code> (heading patterns), <code>group</code> (the parent heading fills a field),
                {' '}<code>set</code> (fixed field values), <code>hooks</code> (a heading whose list becomes Idea quests), <code>create</code> (kinds to create when a name is new).</p></div>
          </div>
          {error && <p className="error">{error}</p>}
          <button onClick={pick}>Other files…</button> <button className="primary" disabled={busy} onClick={preview}>Preview</button>
        </> : <>
          <div className="counts">{Object.entries(r.counts).map(([t, n]) => <div key={t}><b>{n}</b> {(schema.kinds.find((k) => k.id === t)?.plural ?? t).toLowerCase()}</div>)}</div>
          <h4>To settle by hand ({r.issues.length})</h4>
          <ul className="issues-list">{r.issues.map((x) => <li key={x}>{x}</li>)}</ul>
          <p className="muted">These go to Issues. Pages that already exist are left alone.</p>
          <button onClick={() => setR(null)}>Back to the jobs</button> <button className="primary" disabled={busy || !r.pages.length} onClick={commit}>Import {plural(r.pages.length, 'page')}</button>
        </>}
    </Modal>
  )
}

export function Settings() {
  const { project, bridge, engine, git, schema } = useStore()
  const [remote, setRemote] = useState(git?.url ?? '')
  const saveRemote = async (url: string) => {
    try { await call('git:setRemote', url.trim()); useStore.setState({ git: await call('git:status') }); toast(url ? 'Remote saved' : 'Remote removed; the lore folder is local only') } catch (e) { toast(`Git refused: ${e}`) }
  }
  const pickGame = async () => { const r = await call('engine:pickGame'); if (r.game) useStore.setState({ project: { ...project!, game: r.game }, engine: r.engine }) }
  const pickGodot = async () => { const g = await call('engine:pickGodot'); if (g) useStore.setState({ project: { ...project!, godot: g } }) }
  const e = schema.engine
  return (
    <Modal title="Settings">
      <h4>Engine</h4>
      {!e ? <p className="muted">No engine link. <button className="link" onClick={() => useStore.setState({ dialog: 'project' })}>Set one in the project settings</button></p> : <>
        <div className="setting"><label>Game folder</label><span>{project?.game ?? 'Not connected'}</span><button onClick={pickGame}>Choose…</button></div>
        <p className="muted">{engine ? `${Object.keys(engine.quests).length} ${e.name} quests, ${engine.characters.length} characters (${engine.source === 'game' ? 'live' : `snapshot of ${engine.scanned}`}).` : 'Without a game folder, engine badges read the snapshot in the lore folder, if there is one.'}</p>
        {opensInEditor(e) && <>
          <div className="setting"><label>Godot</label><span>{project?.godot ?? 'Not found'}</span><button onClick={pickGodot}>Choose…</button></div>
          <div className="setting"><label>Bridge</label><span>{{ 'no-game': 'No game folder', closed: 'Godot is closed, or the QuestNotes Bridge addon is not enabled', open: 'Connected to the Godot editor' }[bridge]}</span></div>
          <p className="muted">Open in {e.name} needs the QuestNotes Bridge addon in the game project: copy the <code>questnotes_bridge</code> folder into the game's <code>addons/</code> and enable it once under Project Settings › Plugins. It changes nothing in the project. <button className="link" onClick={() => call('shell:addon')}>Show the addon</button></p>
        </>}
      </>}
      <h4>Sharing</h4>
      <div className="setting"><label>Lore repository</label><span>{git?.repo ? (git.remote ? (git.upstream ? 'Shared' : 'Remote set; first Sync publishes it') : 'Local only') : 'Not shared'}</span>
        {!git?.repo && <button onClick={async () => useStore.setState({ git: await call('git:init') })}>Start sharing</button>}</div>
      {git?.repo && <div className="setting"><label>Remote URL</label><input value={remote} placeholder="git@github.com:team/lore.git" onChange={(e) => setRemote(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && remote !== (git.url ?? '') && saveRemote(remote)} />
        <span className="row-actions"><button disabled={remote === (git.url ?? '')} onClick={() => saveRemote(remote)}>{remote ? 'Save' : 'Remove'}</button></span></div>}
      <h4>Project</h4>
      <p className="muted">Page kinds, fields, the quest template and the engine link live in <code>questnotes.yaml</code>.</p>
      <div className="setting"><button onClick={() => useStore.setState({ dialog: 'project' })}>Project settings</button><button onClick={() => useStore.setState({ dialog: 'import' })}>Import design documents…</button></div>
    </Modal>
  )
}

/** questnotes.yaml, edited in place. Kinds and fields left out fall back to the defaults. */
export function ProjectSettings() {
  const project = useStore((s) => s.project)!
  const initial = useMemo(() => writeYaml(project.config), [project.config])
  const [text, setText] = useState(initial)
  const [error, setError] = useState('')
  useEffect(() => { guard = () => text === initial || confirm('Close without saving your changes to the project settings?') }, [text, initial])
  const engine = (() => { try { const e = parse(text)?.engine; return !e ? 'none' : e.preset && !e.quests ? e.preset : 'custom' } catch { return '' } })()
  const edit = (fn: (c: ProjectConfig) => void) => { try { const c = parse(text) ?? {}; fn(c); setText(writeYaml(c)); setError('') } catch (e) { setError(String(e)) } }
  const save = async () => {
    try { const c = parse(text) ?? {}; loadProject(await call('project:saveConfig', c)); close(); toast('Project settings saved') } catch (e) { setError(String(e)) }
  }
  return (
    <Modal title="Project settings" wide>
      <div className="setting"><label>Engine link</label>
        <select value={engine} onChange={(e) => edit((c) => { if (e.target.value === 'none') delete c.engine; else c.engine = e.target.value === 'custom' ? { name: 'Engine', quests: { files: 'quests/**/*.json', id: 'id', title: 'title', stages: 'stages' } } : { preset: e.target.value } })}>
          {engine === '' && <option value="">—</option>}<option value="none">None</option>
          {Object.entries(ENGINE_PRESETS).map(([k, p]) => <option key={k} value={k}>{p.name}</option>)}<option value="custom">Custom (JSON quest files)</option>
        </select>
        <button onClick={() => edit((c) => { for (const [k, v] of Object.entries(DEFAULT_CONFIG)) (c as any)[k] ??= v })}>Write out the defaults</button></div>
      <textarea className="yaml" autoFocus value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} rows={22} />
      <p className="muted small">Leave out <code>kinds</code> and <code>fields</code> to use the defaults (characters, factions, locations and secrets). A field has <code>key</code>, <code>label</code> and <code>kind</code>
        {' '}(text, long, select, ref, rows, tags, number); <code>rows</code> fields name the kinds they point <code>to</code> and their <code>extras</code>. <code>giver: true</code> marks who gives a quest,
        {' '}<code>effect: true</code> puts a field under Effects, <code>matrix</code> adds a table of quests against one kind.</p>
      {error && <p className="error">{error}</p>}
      <button className="primary" onClick={save}>Save and reload</button>
    </Modal>
  )
}

export function SyncDialog() {
  const conflicts = useStore((s) => s.conflicts) ?? []
  const [theirs, setTheirs] = useState<boolean[][]>(conflicts.map((f) => f.conflicts.map(() => false)))
  const finish = async () => {
    const r = await call('git:finish', conflicts.map((f: FileConflict, i) => ({ file: f.file, text: resolve(f.merged, f.conflicts, theirs[i]) })))
    useStore.setState({ dialog: null, conflicts: [], git: await call('git:status') })
    toast(r.error ? `Sync failed: ${r.error}` : 'Synced')
  }
  return (
    <Modal title="Two people changed the same lines" wide>
      <p className="muted">Everything else merged on its own. For each line, keep your version or theirs.</p>
      {conflicts.map((f, i) => <section key={f.file}><h4>{f.file}</h4>{f.conflicts.map((c, j) => <div key={j} className="conflict">
        {[false, true].map((t) => <button key={String(t)} className={theirs[i][j] === t ? 'on' : ''} onClick={() => setTheirs(theirs.map((row, a) => row.map((v, b) => (a === i && b === j ? t : v))))}>
          <small>{t ? 'Theirs' : 'Mine'}</small><pre>{t ? c.theirs : c.ours}</pre></button>)}</div>)}</section>)}
      <button className="primary" onClick={finish}>Finish sync</button>
    </Modal>
  )
}

export const Shortcuts = () => (
  <Modal title="Keyboard shortcuts" wide>
    <table className="keys"><tbody>{[...commands().filter((c) => c.key).map((c) => [c.key!, c.label.replace(/ “.*”/, '')]),
      ['Ctrl K', 'Find a page or run a command (Shift Enter opens a page beside)'], ['Ctrl F', 'Filter the map or the list in view'], ['Ctrl N', 'New quest'], ['Ctrl Q', 'Quit'],
      ['Space', 'Open the selected card beside the map'], ['Enter / Ctrl Enter', 'Open the selected card, or the side panel, in full'], ['1 to 5', 'Set status: Idea, Outline, Draft, Review, Ready'],
      ['Ctrl-click or Shift-click', 'Pick several cards or rows; Delete, 1 to 5 and the menu then act on all of them'],
      ['Delete or Backspace', 'Move the selected cards or rows to the Trash; delete a selected link, frame or note'], ['Arrows', 'Nudge the selected cards 5 px (Shift: 20 px)'],
      ['Drag on empty canvas', 'Select everything the box touches'], ['Alt while dragging', 'Drag without snapping'],
      ['Scroll / Ctrl scroll', 'Pan the map / zoom it'], ['Right-click', 'Everything you can do to a card, header, link or row'],
      ['@ or [[', 'Link a page while writing'], ['/', 'Insert a heading, list or table'], ['Tab', 'Next table cell; a new row after the last one'],
      ['Ctrl + / Ctrl − / Ctrl 0', 'Make everything larger, smaller, or the usual size'], ['Esc', 'Close a menu, dialog, the side panel or a full page; then clear the selection']]
      .map(([k, l]) => <tr key={k + l}><td><kbd>{k}</kbd></td><td>{l}</td></tr>)}</tbody></table>
  </Modal>
)

let launched = false
export function Welcome() {
  const [recent, setRecent] = useState<string[]>([])
  const [name, setName] = useState('')
  const open = async (root: string) => { try { loadProject(await call('project:open', root)) } catch (e) { toast(`Could not open ${root}: ${String(e).replace(/^.*Error: /, '')}`) } }
  useEffect(() => {
    call('app:recent').then((r) => { setRecent(r); if (!launched && r[0]) open(r[0]); launched = true })
  }, [])
  return (
    <div className="welcome">
      <h1>QuestNotes</h1>
      <p className="muted">Branching quest design, in story terms.</p>
      <div className="welcome-actions">
        <section><h4>New project</h4><input value={name} placeholder="Project name" onChange={(e) => setName(e.target.value)} />
          <button className="primary" onClick={async () => { const root = await call('app:pickFolder', 'Choose an empty folder for the lore'); if (root) { loadProject(await call('project:create', root, name.trim() || root.split(/[\\/]/).pop()!)); useStore.setState({ dialog: 'import' }) } }}>Create…</button></section>
        <section><h4>Open a lore folder</h4><button onClick={async () => { const root = await call('app:pickFolder', 'Open a lore folder'); if (root) open(root) }}>Open…</button></section>
      </div>
      {recent.length > 0 && <section><h4>Recent</h4>{recent.map((r) => <div key={r} className="recent-row"><button className="recent" onClick={() => open(r)}>{r}</button>
        <button className="x" title="Remove from this list" onClick={async () => setRecent(await call('app:forget', r))}>×</button></div>)}</section>}
    </div>
  )
}
