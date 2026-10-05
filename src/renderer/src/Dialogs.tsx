import { useEffect, useMemo, useState } from 'react'
import MiniSearch from 'minisearch'
import { useStore, go, peek, openFull, createPage, loadProject, toast, type View } from './store'
import { call } from './api'
import { label } from './derive'
import { normalizeBodies } from './Editor'
import { TYPES, TYPE_INFO } from '../../shared/schema'
import { resolve } from '../../shared/merge'
import type { FileConflict, ImportResult } from '../../shared/api'

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
const COMMANDS: { label: string; key?: string; run: () => void }[] = [
  { label: 'New quest', key: 'N', run: newQuest },
  { label: 'Go to the map', key: 'G M', run: goto('map') }, { label: 'Go to the threshold ledger', key: 'G L', run: goto('ledger') },
  { label: 'Go to the cast matrix', key: 'G C', run: goto('cast') }, { label: 'Go to handoff', key: 'G H', run: goto('handoff') },
  { label: 'Go to issues', key: 'G I', run: goto('issues') },
  { label: 'Show or hide payoff edges', key: 'P', run: () => useStore.setState({ payoffs: !useStore.getState().payoffs }) },
  { label: 'Fit the map', key: 'Z', run: () => window.dispatchEvent(new Event('qn:fit')) },
  { label: 'Import design documents', run: () => useStore.setState({ dialog: 'import' }) },
  { label: 'Sync', run: sync },
  { label: 'Settings', run: () => useStore.setState({ dialog: 'settings' }) },
  { label: 'Keyboard shortcuts', key: '?', run: () => useStore.setState({ dialog: 'shortcuts' }) },
  { label: 'Open the Trash', run: goto('trash') },
  ...TYPES.filter((t) => t !== 'quest').map((t) => ({ label: `New ${TYPE_INFO[t].label.toLowerCase()}`, run: async () => peek(await createPage(t, '')) })),
  { label: 'Switch project', run: () => useStore.setState({ project: undefined, pages: {} }) },
]

export function Palette() {
  const { pages, recent } = useStore()
  const [q, setQ] = useState('')
  const [i, setI] = useState(0)
  const index = useMemo(() => {
    const ms = new MiniSearch({ fields: ['code', 'title', 'aliases', 'text'], searchOptions: { prefix: true, fuzzy: 0.2, boost: { code: 4, title: 3, aliases: 2 } } })
    ms.addAll(Object.values(pages).map((p) => ({ id: p.data.id, code: p.data.code ?? '', title: p.data.title, aliases: (p.data.aliases ?? []).join(' '), text: p.body })))
    return ms
  }, [pages])
  const found = (q ? index.search(q).map((r) => String(r.id)) : recent).filter((id) => pages[id]).slice(0, 10)
  const cmds = COMMANDS.filter((c) => c.label.toLowerCase().includes(q.toLowerCase())).slice(0, q ? 6 : 8)
  const items = [...found.map((id) => ({ key: id, label: label(pages, id), hint: TYPE_INFO[pages[id].data.type].label, run: (side: boolean) => (side ? peek(id) : openFull(id)) })),
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

export function ImportDialog() {
  const [r, setR] = useState<ImportResult | null>(null)
  const [busy, setBusy] = useState(false)
  const commit = async () => {
    setBusy(true)
    const pages = normalizeBodies(r!.pages)
    await call('import:commit', pages)
    const s = useStore.getState()
    const issues = [...s.issues, ...r!.issues.filter((x) => !s.issues.includes(x))]
    useStore.setState({ pages: { ...s.pages, ...Object.fromEntries(pages.map((p) => [p.data.id, p])) }, issues })
    await call('view:write', 'issues', { open: issues })
    close(); go('map'); toast(`Imported ${r!.pages.length} pages`)
  }
  return (
    <Modal title="Bring in the design documents" wide>
      {!r ? <><p>Choose the Broken Wings .docx files: the Quest Index, the Narrative, the character documents and the world document. Nothing is written until you confirm.</p>
        <button className="primary" onClick={async () => setR(await call('import:pick'))}>Choose .docx files…</button></>
        : <>
          <div className="counts">{Object.entries(r.counts).map(([t, n]) => <div key={t}><b>{n}</b> {TYPE_INFO[t as keyof typeof TYPE_INFO].plural.toLowerCase()}</div>)}</div>
          <h4>To settle by hand ({r.issues.length})</h4>
          <ul className="issues-list">{r.issues.map((x) => <li key={x}>{x}</li>)}</ul>
          <p className="muted">These go to Issues. Pages that already exist are left alone.</p>
          <button className="primary" disabled={busy || !r.pages.length} onClick={commit}>Import {r.pages.length} pages</button>
        </>}
    </Modal>
  )
}

export function Settings() {
  const { project, bridge, engine, git } = useStore()
  const [remote, setRemote] = useState('')
  const pickGame = async () => { const r = await call('animus:pickGame'); if (r.game) useStore.setState({ project: { ...project!, game: r.game }, engine: r.engine }) }
  const pickGodot = async () => { const g = await call('animus:pickGodot'); if (g) useStore.setState({ project: { ...project!, godot: g } }) }
  return (
    <Modal title="Settings">
      <h4>Animus</h4>
      <div className="setting"><label>Game folder</label><span>{project?.game ?? 'Not connected'}</span><button onClick={pickGame}>Choose…</button></div>
      <p className="muted">{engine ? `${Object.keys(engine.quests).length} engine quests, ${engine.characters.length} characters (${engine.source === 'game' ? 'live' : `snapshot of ${engine.scanned}`}).` : 'Without a game folder, engine badges read the snapshot in the lore folder, if there is one.'}</p>
      <div className="setting"><label>Godot</label><span>{project?.godot ?? 'Not found'}</span><button onClick={pickGodot}>Choose…</button></div>
      <div className="setting"><label>Bridge</label><span>{{ 'no-game': 'No game folder', closed: 'Godot is closed, or the QuestNotes Bridge addon is not enabled', open: 'Connected to the Godot editor' }[bridge]}</span></div>
      <p className="muted">Open in Animus needs the QuestNotes Bridge addon in the game project: copy the <code>questnotes_bridge</code> folder into the game's <code>addons/</code> and enable it once under Project Settings › Plugins. It touches nothing in Animus. <button className="link" onClick={() => call('shell:addon')}>Show the addon</button></p>
      <h4>Sharing</h4>
      <div className="setting"><label>Lore repository</label><span>{git?.repo ? (git.remote ? (git.upstream ? 'Shared' : 'Remote set; first Sync publishes it') : 'Local only') : 'Not shared'}</span>
        {!git?.repo && <button onClick={async () => useStore.setState({ git: await call('git:init') })}>Start sharing</button>}</div>
      {git?.repo && !git.remote && <div className="setting"><label>Remote URL</label><input value={remote} placeholder="git@github.com:team/broken-wings-lore.git" onChange={(e) => setRemote(e.target.value)} />
        <button disabled={!remote} onClick={async () => { await call('git:setRemote', remote); useStore.setState({ git: await call('git:status') }) }}>Save</button></div>}
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
    <table className="keys"><tbody>{[...COMMANDS.filter((c) => c.key).map((c) => [c.key!, c.label]),
      ['Ctrl K', 'Find a page or run a command'], ['Space', 'Open the selected card beside the map'], ['Enter', 'Open the selected card in full'],
      ['1 to 5', 'Set status: Idea, Outline, Draft, Review, Ready'], ['Delete', 'Move the selected page to the Trash'], ['Arrows', 'Move the selection on the map'],
      ['F', 'Filter the map'], ['Shift 1 to 3', 'Fit one Act'], ['@ or [[', 'Link a page while writing'], ['/', 'Insert a heading, list or table'], ['Esc', 'Close the side panel']]
      .map(([k, l]) => <tr key={k}><td><kbd>{k}</kbd></td><td>{l}</td></tr>)}</tbody></table>
  </Modal>
)

export function Welcome() {
  const [recent, setRecent] = useState<string[]>([])
  const [name, setName] = useState('Broken Wings')
  useEffect(() => { call('app:recent').then(setRecent) }, [])
  const open = async (root: string) => { try { loadProject(await call('project:open', root)) } catch (e) { toast(String(e)) } }
  return (
    <div className="welcome">
      <h1>QuestNotes</h1>
      <p className="muted">Quest design for Broken Wings, in lore terms.</p>
      <div className="welcome-actions">
        <section><h4>New project</h4><input value={name} onChange={(e) => setName(e.target.value)} />
          <button className="primary" onClick={async () => { const root = await call('app:pickFolder', 'Choose an empty folder for the lore'); if (root) { loadProject(await call('project:create', root, name)); useStore.setState({ dialog: 'import' }) } }}>Create…</button></section>
        <section><h4>Open a lore folder</h4><button onClick={async () => { const root = await call('app:pickFolder', 'Open a lore folder'); if (root) open(root) }}>Open…</button></section>
      </div>
      {recent.length > 0 && <section><h4>Recent</h4>{recent.map((r) => <button key={r} className="recent" onClick={() => open(r)}>{r}</button>)}</section>}
    </div>
  )
}
