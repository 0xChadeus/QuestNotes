import { useEffect, useMemo, useState } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import { useStore, remoteChange, go, peek, openFull, createPage, undo, redo, goBack, goForward, duplicate, flushAll, targets, trashPages, setStatus, nudge, walk, type View } from './store'
import { on, call } from './api'
import { MapView } from './MapView'
import { PageView } from './PageView'
import { Brief } from './Brief'
import { Matrix, Cast, Handoff, Issues, PageList, Trash } from './Tables'
import { Palette, ImportDialog, Settings, ProjectSettings, SyncDialog, Shortcuts, Welcome, AskDialog, newQuest, sync, saveNow, current, switchProject, closeDialog } from './Dialogs'
import { Toasts, ContextMenu, openMenu, pageMenu, rename } from './ui'
import { byType, issues, label } from './derive'
import { questState } from '../../shared/engine'
import { kindOf, STATUSES, STATUS_LABEL, type Schema } from '../../shared/schema'

const views = (s: Schema): [View, string][] =>
  [['map', 'Map'], ...(s.matrix ? [['matrix', s.matrix.title] as [View, string]] : []), ['cast', 'Cast'], ['handoff', 'Handoff'], ['issues', 'Issues']]
const viewTitle = (s: ReturnType<typeof useStore.getState>) => s.full ? label(s.pages, s.full) : views(s.schema).find(([v]) => v === s.view)?.[1]
  ?? (s.view.startsWith('list:') ? kindOf(s.schema, s.view.slice(5))?.plural ?? s.view.slice(5) : 'Trash')
const stored = (k: string, d: number) => { try { return +(localStorage.getItem(k) ?? d) || d } catch { return d } }

export function App() {
  const { project, view, full, peek: stack, brief, palette, dialog } = useStore()
  const title = useStore(viewTitle)
  const [width, setWidth] = useState(() => stored('qn.peek', 600))
  useEffect(() => {
    const offs = [on('page:changed', remoteChange), on('engine:index', (engine) => useStore.setState({ engine })), on('bridge:state', (bridge) => useStore.setState({ bridge })),
      // The window is closing: write what is still pending (text typed a moment ago), then let it close.
      on('app:closing', () => { flushAll().finally(() => call('app:closed')) })]
    const mouse = (e: MouseEvent) => { if (e.button === 3) goBack(); if (e.button === 4) goForward() }
    window.addEventListener('mouseup', mouse)
    return () => { offs.forEach((off) => off()); window.removeEventListener('mouseup', mouse) }
  }, [])
  useEffect(() => { document.title = project ? `${title} — ${project.config.name} — QuestNotes` : 'QuestNotes' }, [project, title])
  useKeys()
  if (!project) return <><Welcome /><ContextMenu /><Toasts /></>
  const top = stack[stack.length - 1]
  const main = full ? <PageView key={full} id={full} /> : view === 'map' ? <ReactFlowProvider><MapView /></ReactFlowProvider>
    : view === 'matrix' ? <Matrix /> : view === 'cast' ? <Cast /> : view === 'handoff' ? <Handoff /> : view === 'issues' ? <Issues /> : view === 'trash' ? <Trash />
    : <PageList key={view} type={view.slice(5)} />
  /** Dragging the side panel's left edge sets its width, kept for next time. */
  const grip = (e: React.MouseEvent) => {
    e.preventDefault()
    const move = (m: MouseEvent) => setWidth(Math.max(420, Math.min(innerWidth - 520, innerWidth - m.clientX)))
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); setWidth((w) => { try { localStorage.setItem('qn.peek', String(w)) } catch { /* not kept */ } return w }) }
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up)
  }
  return (
    <div className="app">
      <Sidebar />
      <main><TopBar title={title} /><div className={`content${full ? ' full' : view === 'map' ? ' fixed' : ''}`}>{main}</div></main>
      {top && <aside className="peek" style={{ width }}>
        <div className="peek-grip" onMouseDown={grip} title="Drag to resize" />
        <div className="peek-bar">{stack.length > 1 && <button title="Previous page in the panel" onClick={() => useStore.setState({ peek: stack.slice(0, -1), brief: false })}>←</button>}
          <span className="crumb" onContextMenu={(e) => openMenu(e, pageMenu(top))}>{label(useStore.getState().pages, top)}</span>
          <button onClick={() => openFull(top)} title="Ctrl Enter">Open full</button><button className="x" title="Close (Esc)" onClick={() => useStore.setState({ peek: [] })}>×</button></div>
        <div className="peek-body">{brief ? <Brief id={top} /> : <PageView key={top} id={top} inPeek />}</div>
      </aside>}
      {palette && <Palette />}
      {dialog === 'import' && <ImportDialog />}{dialog === 'settings' && <Settings />}{dialog === 'project' && <ProjectSettings />}{dialog === 'sync' && <SyncDialog />}{dialog === 'shortcuts' && <Shortcuts />}{dialog === 'ask' && <AskDialog />}
      <ContextMenu />
      <Toasts />
    </div>
  )
}

function Sidebar() {
  const { project, pages, view, full, engine, bridge, recent, issues: imported, schema } = useStore()
  const needs = useMemo(() => byType(pages, 'quest').filter((q) => questState(q.data, engine) === 'needs').length, [pages, engine])
  const open = useMemo(() => issues(schema, pages, imported).length + (project?.errors.length ?? 0), [schema, pages, imported, project])
  const count = (t: string) => Object.values(pages).filter((p) => p.data.type === t).length
  const item = (v: View, text: string, badge?: number, amber?: boolean, menu?: () => void) =>
    <button key={v} className={view === v && !full ? 'on' : ''} onClick={() => go(v)} onContextMenu={menu && ((e) => { e.preventDefault(); menu() })}>{text}{badge ? <span className={`count${amber ? ' amber' : ''}`}>{badge}</span> : null}</button>
  const projectMenu = (e: React.MouseEvent) => openMenu(e, [
    { label: 'Project settings', run: () => useStore.setState({ dialog: 'project' }) },
    { label: 'Import design documents…', run: () => useStore.setState({ dialog: 'import' }) },
    { label: 'Open the lore folder', run: () => call('shell:open', '') },
    '-', { label: 'Switch project', run: switchProject },
  ])
  return (
    <nav className="sidebar">
      <button className="project" title={project!.root} onClick={projectMenu} onContextMenu={projectMenu}>{project!.config.name} <span className="muted">▾</span></button>
      <button className="search" onClick={() => useStore.setState({ palette: true })}>Search or run… <kbd>Ctrl K</kbd></button>
      <h5>Views</h5>{views(schema).map(([v, t]) => item(v, t, v === 'handoff' ? needs : v === 'issues' ? open : 0, v === 'handoff'))}
      <h5>Pages</h5>{schema.kinds.map((k) => <span key={k.id} onContextMenu={(e) => openMenu(e, [{ label: `New ${k.label.toLowerCase()}`, run: async () => peek(await createPage(k.id, '')) }])}>{item(`list:${k.id}`, k.plural, count(k.id))}</span>)}
      {recent.length > 0 && <><h5>Recent</h5>{recent.filter((id) => pages[id]).map((id) => <button key={id} onClick={() => peek(id)} onContextMenu={(e) => openMenu(e, pageMenu(id))}>{label(pages, id)}</button>)}</>}
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

function TopBar({ title }: { title: string }) {
  const { full, saved, git, canUndo, canRedo, dirty, failed } = useStore()
  const recentlySaved = Date.now() - saved < 1500
  const words = !git?.repo ? 'Not shared' : git.merging ? 'Finish sync' : git.changed ? `${git.changed} change${git.changed > 1 ? 's' : ''} to share`
    : git.behind ? `${git.behind} new from others` : !git.remote ? 'Saved locally' : !git.upstream ? 'Not sent yet' : git.ahead ? `${git.ahead} to send` : 'Up to date'
  return (
    <div className="topbar">
      {full && <button title="Back (Esc or Alt ←)" onClick={leavePage}>←</button>}
      <span className="crumb" onContextMenu={(e) => full && openMenu(e, pageMenu(full))}>{title}</span>
      {failed ? <button className="saved bad" title="Some changes could not be written to disk" onClick={saveNow}>Not saved · Retry</button>
        : <span className={`saved${dirty || recentlySaved ? ' on' : ''}`}>{dirty ? 'Saving…' : 'Saved'}</span>}
      <div className="spacer" />
      <button className="icon" disabled={!canUndo} title={canUndo ? `Undo ${canUndo.toLowerCase()} (Ctrl Z)` : 'Nothing to undo'} onClick={() => undo()}>↶</button>
      <button className="icon" disabled={!canRedo} title={canRedo ? `Redo ${canRedo.toLowerCase()} (Ctrl Shift Z)` : 'Nothing to redo'} onClick={redo}>↷</button>
      <button onClick={newQuest} title="N or Ctrl N">New quest</button>
      <button className="sync" title="Sync" onClick={() => (git?.repo ? sync() : useStore.setState({ dialog: 'settings' }))}>{words}</button>
    </div>
  )
}
const goBackOr = (fallback: () => void) => { const before = useStore.getState().full; goBack(); if (useStore.getState().full === before) fallback() }

const inText = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable="true"]')
const onControl = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest?.('button, a, summary, [role="menuitem"], input[type="checkbox"]')
const leavePage = () => goBackOr(() => useStore.setState({ full: null }))
function useKeys() {
  useEffect(() => {
    let g = false
    const h = (e: KeyboardEvent) => {
      const s = useStore.getState()
      const mod = e.ctrlKey || e.metaKey, key = e.key.toLowerCase(), typing = inText(e.target)
      if (e.key === 'Escape') {
        if (e.defaultPrevented) return // a picker or suggestion list closed itself
        if (s.menu) useStore.setState({ menu: undefined })
        else if (s.dialog) closeDialog()
        else if (s.palette) useStore.setState({ palette: false })
        else if (s.peek.length) useStore.setState({ peek: [] })
        else if (s.full && !typing) leavePage()
        else if (!typing) useStore.setState({ selected: null, multi: [] })
        return
      }
      if (mod && !e.altKey && ['=', '+', '-', '0'].includes(e.key)) { e.preventDefault(); call('app:zoom', e.key === '0' ? 0 : e.key === '-' ? -1 : 1); return }
      if (mod && key === 'q') { e.preventDefault(); window.close(); return }
      if (!s.project) return
      if (mod && key === 'k') { e.preventDefault(); useStore.setState({ palette: !s.palette }); return }
      if (mod && key === 's') { e.preventDefault(); saveNow(); return }
      if (mod && key === 'n') { e.preventDefault(); newQuest(); return }
      if (mod && key === 'w') { e.preventDefault(); if (s.peek.length) useStore.setState({ peek: [] }); else if (s.full) leavePage(); return }
      if (mod && key === 'f') {
        e.preventDefault()
        const box = (s.view === 'map' && !s.full ? document.getElementById('map-filter') : document.querySelector('.table-view .toolbar input:not([type])')) as HTMLInputElement | null
        if (box && !s.full) box.focus(); else useStore.setState({ palette: true })
        return
      }
      if (mod && e.key === 'Enter' && s.peek.length) { openFull(s.peek[s.peek.length - 1]); return }
      if (s.dialog || s.palette || s.menu || typing) return
      if (mod && (key === 'z' || key === 'y')) { e.preventDefault(); if (key === 'y' || e.shiftKey) redo(); else undo(); return }
      if (mod && key === 'g') { e.preventDefault(); window.dispatchEvent(new Event('qn:frame')); return }
      if (mod && key === 'd') { e.preventDefault(); const id = current(); if (id) duplicate(id); return }
      if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); if (e.key === 'ArrowLeft') goBack(); else goForward(); return }
      if (mod || e.altKey) return
      if ((e.key === 'Enter' || e.key === ' ') && onControl(e.target)) return // the focused button gets its own key
      if (e.key === 'F2') { const id = current(); if (id) { e.preventDefault(); rename(id) } return }
      // Keys that act on the selection only while that selection is on screen: a card on the map or a row in a list.
      const shown = !s.full && (s.view === 'map' || s.view.startsWith('list:'))
      const sel = shown ? targets() : []
      if (sel.length) {
        const one = sel[sel.length - 1], quests = sel.filter((id) => s.pages[id].data.type === 'quest')
        const act: Record<string, () => void> = {
          ' ': () => peek(one), Enter: () => openFull(one), Delete: () => trashPages(sel), Backspace: () => trashPages(sel),
          ...Object.fromEntries(STATUSES.slice(0, 5).map((st, i) => [String(i + 1), () => quests.length && setStatus(quests, st, STATUS_LABEL[st])])),
          ...(s.view === 'map' ? Object.fromEntries(([['ArrowLeft', -1, 0], ['ArrowRight', 1, 0], ['ArrowUp', 0, -1], ['ArrowDown', 0, 1]] as const)
            .map(([k, dx, dy]) => [k, () => nudge(quests, dx * (e.shiftKey ? 20 : 5), dy * (e.shiftKey ? 20 : 5))])) : {}),
          ...(s.view === 'map' ? { '[': () => walk(-1), ']': () => walk(1) } : {}),
        }
        if (act[e.key]) { e.preventDefault(); act[e.key](); return }
      }
      if (g) { g = false; const v = ({ m: 'map', x: s.schema.matrix ? 'matrix' : undefined, c: 'cast', h: 'handoff', i: 'issues' } as Record<string, View | undefined>)[e.key]; if (v) go(v); return }
      if (e.shiftKey && (e.code === 'Digit1' || e.code === 'Digit2')) { window.dispatchEvent(new CustomEvent('qn:fit', { detail: e.code === 'Digit2' ? 'selection' : 'all' })); return }
      // Single letters belong to the map and lists, never to a page, where a stray letter would be lost typing.
      if ((e.target as HTMLElement).closest?.('.page, .peek') && e.key !== '?') return
      const act: Record<string, () => void> = {
        g: () => { g = true; setTimeout(() => (g = false), 1200) }, n: newQuest, '?': () => useStore.setState({ dialog: 'shortcuts' }),
        p: () => useStore.setState({ payoffs: !s.payoffs }), z: () => window.dispatchEvent(new Event('qn:fit')),
        f: () => document.getElementById('map-filter')?.focus(),
      }
      if (act[e.key]) { e.preventDefault(); act[e.key]() }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])
}
