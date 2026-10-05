import { useEffect, useMemo } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import { useStore, remoteChange, go, peek, openFull, setData, trashPage, type View } from './store'
import { on } from './api'
import { MapView } from './MapView'
import { PageView } from './PageView'
import { Brief } from './Brief'
import { Matrix, Cast, Handoff, Issues, PageList, Trash } from './Tables'
import { Palette, ImportDialog, Settings, ProjectSettings, SyncDialog, Shortcuts, Welcome, newQuest, sync } from './Dialogs'
import { Toasts } from './ui'
import { byType, issues, label } from './derive'
import { questState } from '../../shared/engine'
import { kindOf, STATUSES, type Schema } from '../../shared/schema'

const views = (s: Schema): [View, string][] =>
  [['map', 'Map'], ...(s.matrix ? [['matrix', s.matrix.title] as [View, string]] : []), ['cast', 'Cast'], ['handoff', 'Handoff'], ['issues', 'Issues']]

export function App() {
  const { project, view, full, peek: stack, brief, palette, dialog } = useStore()
  useEffect(() => {
    const offs = [on('page:changed', remoteChange), on('engine:index', (engine) => useStore.setState({ engine })), on('bridge:state', (bridge) => useStore.setState({ bridge }))]
    return () => offs.forEach((off) => off())
  }, [])
  useKeys()
  if (!project) return <><Welcome /><Toasts /></>
  const top = stack[stack.length - 1]
  const main = full ? <PageView key={full} id={full} /> : view === 'map' ? <ReactFlowProvider><MapView /></ReactFlowProvider>
    : view === 'matrix' ? <Matrix /> : view === 'cast' ? <Cast /> : view === 'handoff' ? <Handoff /> : view === 'issues' ? <Issues /> : view === 'trash' ? <Trash />
    : <PageList type={view.slice(5)} />
  return (
    <div className="app">
      <Sidebar />
      <main><TopBar /><div className={`content${full ? ' full' : view === 'map' ? ' fixed' : ''}`}>{main}</div></main>
      {top && <aside className="peek">
        <div className="peek-bar">{stack.length > 1 && <button onClick={() => useStore.setState({ peek: stack.slice(0, -1), brief: false })}>←</button>}
          <span className="crumb">{label(useStore.getState().pages, top)}</span><button onClick={() => openFull(top)}>Open full</button><button className="x" onClick={() => useStore.setState({ peek: [] })}>×</button></div>
        <div className="peek-body">{brief ? <Brief id={top} /> : <PageView key={top} id={top} inPeek />}</div>
      </aside>}
      {palette && <Palette />}
      {dialog === 'import' && <ImportDialog />}{dialog === 'settings' && <Settings />}{dialog === 'project' && <ProjectSettings />}{dialog === 'sync' && <SyncDialog />}{dialog === 'shortcuts' && <Shortcuts />}
      <Toasts />
    </div>
  )
}

function Sidebar() {
  const { project, pages, view, full, engine, bridge, recent, issues: imported, schema } = useStore()
  const needs = useMemo(() => byType(pages, 'quest').filter((q) => questState(q.data, engine) === 'needs').length, [pages, engine])
  const open = useMemo(() => issues(schema, pages, imported).length, [schema, pages, imported])
  const count = (t: string) => Object.values(pages).filter((p) => p.data.type === t).length
  const item = (v: View, text: string, badge?: number, amber?: boolean) =>
    <button key={v} className={view === v && !full ? 'on' : ''} onClick={() => go(v)}>{text}{badge ? <span className={`count${amber ? ' amber' : ''}`}>{badge}</span> : null}</button>
  return (
    <nav className="sidebar">
      <div className="project">{project!.config.name}</div>
      <button className="search" onClick={() => useStore.setState({ palette: true })}>Search or run… <kbd>Ctrl K</kbd></button>
      <h5>Views</h5>{views(schema).map(([v, t]) => item(v, t, v === 'handoff' ? needs : v === 'issues' ? open : 0, v === 'handoff'))}
      <h5>Pages</h5>{schema.kinds.map((k) => item(`list:${k.id}`, k.plural, count(k.id)))}
      {recent.length > 0 && <><h5>Recent</h5>{recent.filter((id) => pages[id]).map((id) => <button key={id} onClick={() => peek(id)}>{label(pages, id)}</button>)}</>}
      <div className="spacer" />
      {item('trash', 'Trash')}
      {schema.engine && <button className="engine-line" onClick={() => useStore.setState({ dialog: 'settings' })}>
        <span className={`dot ${bridge === 'open' ? 'green' : engine ? 'amber' : 'grey'}`} />
        {engine ? `${project!.game ? project!.game.split(/[\\/]/).pop() : 'Snapshot'} · ${Object.keys(engine.quests).length} ${schema.engine.name} quest${Object.keys(engine.quests).length === 1 ? '' : 's'}${bridge === 'open' ? ' · Godot open' : ''}` : `Not connected to ${schema.engine.name}`}
      </button>}
      <button onClick={() => useStore.setState({ dialog: 'settings' })}>Settings</button>
    </nav>
  )
}

function TopBar() {
  const { view, full, pages, saved, git, schema } = useStore()
  const recentlySaved = Date.now() - saved < 1500
  const title = full ? label(pages, full) : views(schema).find(([v]) => v === view)?.[1] ?? (view.startsWith('list:') ? kindOf(schema, view.slice(5))?.plural ?? view.slice(5) : 'Trash')
  const words = !git?.repo ? 'Not shared' : git.merging ? 'Finish sync' : git.changed ? `${git.changed} change${git.changed > 1 ? 's' : ''} to share` : git.behind ? `${git.behind} new from others` : git.remote ? 'Up to date' : 'Saved locally'
  return (
    <div className="topbar">
      {full && <button onClick={() => useStore.setState({ full: null })}>←</button>}
      <span className="crumb">{title}</span>
      <span className={`saved${recentlySaved ? ' on' : ''}`}>Saved</span>
      <div className="spacer" />
      <button onClick={newQuest}>New quest</button>
      <button className="sync" title="Sync" onClick={() => (git?.repo ? sync() : useStore.setState({ dialog: 'settings' }))}>{words}</button>
    </div>
  )
}

function useKeys() {
  useEffect(() => {
    let g = false
    const h = (e: KeyboardEvent) => {
      const s = useStore.getState()
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); useStore.setState({ palette: !s.palette }); return }
      if (mod && e.key === 'Enter' && s.peek.length) { openFull(s.peek[s.peek.length - 1]); return }
      if (e.key === 'Escape') { if (s.dialog || s.palette) useStore.setState({ dialog: null, palette: false }); else if (s.peek.length) useStore.setState({ peek: [] }); return }
      if (!s.project || mod || e.altKey || (e.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]')) return
      if (g) { g = false; const v = ({ m: 'map', x: s.schema.matrix ? 'matrix' : undefined, c: 'cast', h: 'handoff', i: 'issues' } as Record<string, View | undefined>)[e.key]; if (v) go(v); return }
      const sel = s.selected && s.pages[s.selected] ? s.selected : null
      if (e.shiftKey && /^Digit[1-4]$/.test(e.code)) { window.dispatchEvent(new CustomEvent('qn:fit', { detail: +e.code.slice(5) })); return }
      const act: Record<string, () => void> = {
        g: () => { g = true; setTimeout(() => (g = false), 1200) }, n: newQuest, '?': () => useStore.setState({ dialog: 'shortcuts' }),
        p: () => useStore.setState({ payoffs: !s.payoffs }), z: () => window.dispatchEvent(new Event('qn:fit')),
        f: () => document.getElementById('map-filter')?.focus(),
      }
      if (sel) Object.assign(act, {
        ' ': () => peek(sel), Enter: () => openFull(sel), Delete: () => trashPage(sel),
        ...Object.fromEntries(STATUSES.slice(0, 5).map((st, i) => [String(i + 1), () => s.pages[sel].data.type === 'quest' && setData(sel, { status: st })])),
        ...Object.fromEntries(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].map((k) => [k, () => window.dispatchEvent(new CustomEvent('qn:arrow', { detail: k }))])),
      })
      if (act[e.key]) { e.preventDefault(); act[e.key]() }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])
}
