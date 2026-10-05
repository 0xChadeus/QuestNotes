// The narrow API the window gets from the main process: invoke channels and events.
import type { Page } from './page'
import type { EngineIndex } from './engine'
import type { Conflict } from './merge'

export interface GitStatus { repo: boolean; changed: number; ahead: number; behind: number; upstream: boolean; remote: boolean; merging: boolean }
export interface FileConflict { file: string; merged: string; conflicts: Conflict[] }
export type BridgeState = 'no-game' | 'closed' | 'open'
export interface MapView { cells?: Record<string, string[]> }
export interface Project {
  root: string; name: string; pages: Page[]; errors: { file: string; error: string }[]
  map: MapView; git: GitStatus; engine: EngineIndex | null; bridge: BridgeState; game?: string; godot?: string; issues: string[]
}
export interface ImportResult { pages: Page[]; issues: string[]; counts: Record<string, number> }

export interface Invoke {
  'app:recent': () => string[]
  'app:pickFolder': (title: string) => string | null
  'project:create': (root: string, name: string) => Project
  'project:open': (root: string) => Project
  'page:write': (page: Page) => void
  'page:trash': (file: string) => void
  'page:restore': (file: string) => void
  'trash:list': () => Page[]
  'trash:empty': () => void
  'view:write': (name: string, view: object) => void
  'git:status': () => GitStatus
  'git:init': () => GitStatus
  'git:sync': () => { error?: string; conflicts?: FileConflict[] }
  'git:finish': (resolved: { file: string; text: string }[]) => { error?: string; conflicts?: FileConflict[] }
  'git:history': (file: string, since: string) => string[]
  'git:setRemote': (url: string) => void
  'animus:pickGame': () => { game?: string; engine: EngineIndex | null }
  'animus:pickGodot': () => string | null
  'animus:open': (resPath: string, stage?: string) => { ok: boolean; error?: string; started?: boolean }
  'import:pick': () => ImportResult | null
  'import:commit': (pages: Page[]) => void
  'shell:open': (file: string) => void
  'shell:addon': () => void
}
export interface Events {
  'page:changed': (file: string, page: Page | null) => void
  'engine:index': (index: EngineIndex | null) => void
  'bridge:state': (state: BridgeState) => void
}
export const EVENTS: (keyof Events)[] = ['page:changed', 'engine:index', 'bridge:state']
