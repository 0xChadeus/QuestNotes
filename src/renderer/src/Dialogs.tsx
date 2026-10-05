import { useEffect, useMemo, useState } from 'react'
import MiniSearch from 'minisearch'
import { useStore, go, peek, openFull, createPage, loadProject, toast, type View } from './store'
import { call } from './api'
import { kindLabel, label } from './derive'
import { normalizeBodies } from './Editor'
import { DEFAULT_CONFIG, type ImportJob, type ProjectConfig } from '../../shared/schema'
import { ENGINE_PRESETS, opensInEditor } from '../../shared/engine'
import { writeYaml } from '../../shared/page'
import { resolve } from '../../shared/merge'
import type { FileConflict, ImportFile, ImportResult } from '../../shared/api'
import { parse } from 'yaml'

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`
const close = () => useStore.setState({ dialog: null, palette: false })
const Modal = ({ title, children, wide }: { title: string; children: React.ReactNode; wide?: boolean }) => (
  <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && close()}>
    <div className={`modal${wide ? ' wide' : ''}`}><header><h3>{title}</h3><button className="x" onClick={close}>×</button></header>{children}</div>
  </div>
)

export const newQuest = async () => peek(await createPage('quest', '', { status: 'idea' }))
export async function sync() {
  const r = await call('git:sync')
  if (r.conflicts?.length) { useStore.setState({ dialog: 'sync', conflicts: r.conflicts }); return }
  useStore.setState({ git: await call('git:status') })
  toast(r.error ? `Sync failed: ${r.error}` : 'Synced')
}
const goto = (v: View) => () => go(v)
function commands(): { label: string; key?: string; run: () => void }[] {
  const s = useStore.getState().schema
  return [
    { label: 'New quest', key: 'N', run: newQuest },
    { label: 'Go to the map', key: 'G M', run: goto('map') },
    ...(s.matrix ? [{ label: `Go to the ${s.matrix.title.toLowerCase()}`, key: 'G X', run: goto('matrix') }] : []),
    { label: 'Go to the cast', key: 'G C', run: goto('cast') }, { label: 'Go to handoff', key: 'G H', run: goto('handoff') },
    { label: 'Go to issues', key: 'G I', run: goto('issues') },
    { label: 'Show or hide payoff edges', key: 'P', run: () => useStore.setState({ payoffs: !useStore.getState().payoffs }) },
    { label: 'Fit the map', key: 'Z', run: () => window.dispatchEvent(new Event('qn:fit')) },
    { label: 'Import design documents', run: () => useStore.setState({ dialog: 'import' }) },
    { label: 'Sync', run: sync },
    { label: 'Settings', run: () => useStore.setState({ dialog: 'settings' }) },
    { label: 'Project settings', run: () => useStore.setState({ dialog: 'project' }) },
    { label: 'Keyboard shortcuts', key: '?', run: () => useStore.setState({ dialog: 'shortcuts' }) },
    { label: 'Open the Trash', run: goto('trash') },
    ...s.kinds.filter((k) => k.id !== 'quest').map((k) => ({ label: `New ${k.label.toLowerCase()}`, run: async () => peek(await createPage(k.id, '')) })),
    { label: 'Switch project', run: () => useStore.setState({ project: undefined, pages: {} }) },
  ]
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
  const found = (q ? index.search(q).map((r) => String(r.id)) : recent).filter((id) => pages[id]).slice(0, 10)
  const cmds = commands().filter((c) => c.label.toLowerCase().includes(q.toLowerCase())).slice(0, q ? 6 : 8)
  const items = [...found.map((id) => ({ key: id, label: label(pages, id), hint: kindLabel(schema, pages[id].data.type), run: (side: boolean) => (side ? peek(id) : openFull(id)) })),
    ...cmds.map((c) => ({ key: c.label, label: c.label, hint: c.key ?? '', run: () => c.run() }))]
  const run = (n: number, side = false) => { close(); items[n]?.run(side) }
  return (
    <div className="overlay top" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="palette">
        <input autoFocus value={q} placeholder="Find a page or run a command…" onChange={(e) => { setQ(e.target.value); setI(0) }} onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { setI(Math.min(i + 1, items.length - 1)); e.preventDefault() }
          if (e.key === 'ArrowUp') { setI(Math.max(i - 1, 0)); e.preventDefault() }
          if (e.key === 'Enter') run(i, e.shiftKey)
          if (e.key === 'Escape') close()
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
  const [remote, setRemote] = useState('')
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
      {git?.repo && !git.remote && <div className="setting"><label>Remote URL</label><input value={remote} placeholder="git@github.com:team/lore.git" onChange={(e) => setRemote(e.target.value)} />
        <button disabled={!remote} onClick={async () => { await call('git:setRemote', remote); useStore.setState({ git: await call('git:status') }) }}>Save</button></div>}
      <h4>Project</h4>
      <p className="muted">Page kinds, fields, the quest template and the engine link live in <code>questnotes.yaml</code>.</p>
      <div className="setting"><button onClick={() => useStore.setState({ dialog: 'project' })}>Project settings</button><button onClick={() => useStore.setState({ dialog: 'import' })}>Import design documents…</button></div>
    </Modal>
  )
}

/** questnotes.yaml, edited in place. Kinds and fields left out fall back to the defaults. */
export function ProjectSettings() {
  const project = useStore((s) => s.project)!
  const [text, setText] = useState(writeYaml(project.config))
  const [error, setError] = useState('')
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
      <textarea className="yaml" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} rows={22} />
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
  <Modal title="Keyboard shortcuts">
    <table className="keys"><tbody>{[...commands().filter((c) => c.key).map((c) => [c.key!, c.label]),
      ['Ctrl K', 'Find a page or run a command'], ['Space', 'Open the selected card beside the map'], ['Enter', 'Open the selected card in full'],
      ['1 to 5', 'Set status: Idea, Outline, Draft, Review, Ready'], ['Delete', 'Move the selected page to the Trash'], ['Arrows', 'Move the selection on the map'],
      ['F', 'Filter the map'], ['Shift 1 to 3', 'Fit one Act'], ['@ or [[', 'Link a page while writing'], ['/', 'Insert a heading, list or table'], ['Esc', 'Close the side panel']]
      .map(([k, l]) => <tr key={k}><td><kbd>{k}</kbd></td><td>{l}</td></tr>)}</tbody></table>
  </Modal>
)

export function Welcome() {
  const [recent, setRecent] = useState<string[]>([])
  const [name, setName] = useState('')
  useEffect(() => { call('app:recent').then(setRecent) }, [])
  const open = async (root: string) => { try { loadProject(await call('project:open', root)) } catch (e) { toast(String(e)) } }
  return (
    <div className="welcome">
      <h1>QuestNotes</h1>
      <p className="muted">Branching quest design, in story terms.</p>
      <div className="welcome-actions">
        <section><h4>New project</h4><input value={name} placeholder="Project name" onChange={(e) => setName(e.target.value)} />
          <button className="primary" onClick={async () => { const root = await call('app:pickFolder', 'Choose an empty folder for the lore'); if (root) { loadProject(await call('project:create', root, name.trim() || root.split(/[\\/]/).pop()!)); useStore.setState({ dialog: 'import' }) } }}>Create…</button></section>
        <section><h4>Open a lore folder</h4><button onClick={async () => { const root = await call('app:pickFolder', 'Open a lore folder'); if (root) open(root) }}>Open…</button></section>
      </div>
      {recent.length > 0 && <section><h4>Recent</h4>{recent.map((r) => <button key={r} className="recent" onClick={() => open(r)}>{r}</button>)}</section>}
    </div>
  )
}
