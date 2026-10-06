// The narrow API the window gets from the main process: invoke channels and events.
import type { Page } from './page'
import type { EngineIndex } from './engine'
import type { Conflict } from './merge'
import type { ImportJob, ProjectConfig } from './schema'
import type { MapView } from './map'
export type { MapView }

export interface GitStatus { repo: boolean; changed: number; ahead: number; behind: number; upstream: boolean; remote: boolean; url?: string; merging: boolean }
export interface FileConflict { file: string; merged: string; conflicts: Conflict[] }
/** A sync's outcome: an error, lines two people changed alike, or notes on what the sync settled by itself. */
export interface Synced { error?: string; conflicts?: FileConflict[]; notes?: string[] }
export type BridgeState = 'no-game' | 'closed' | 'open'
export interface Project {
  root: string; config: ProjectConfig; pages: Page[]; errors: { file: string; error: string }[]; trashed: string[]
  map: MapView; git: GitStatus; engine: EngineIndex | null; bridge: BridgeState; game?: string; godot?: string; issues: string[]
}
export interface ImportResult { pages: Page[]; issues: string[]; counts: Record<string, number> }
export interface ImportFile { name: string; outline: string }

export interface Invoke {
  'app:recent': () => string[]
  'app:pickFolder': (title: string) => string | null
  'app:forget': (root: string) => string[]
  'app:zoom': (step: -1 | 0 | 1) => number
  'app:closed': () => void
  'project:create': (root: string, name: string) => Project
  'project:open': (root: string) => Project
  'project:saveConfig': (config: ProjectConfig) => Project
  'page:write': (page: Page) => void
  'page:trash': (file: string) => string
  'page:restore': (trashed: string, to?: string) => void
  'page:delete': (file: string) => void
  'trash:list': () => Page[]
  'trash:empty': () => void
  'trash:delete': (file: string) => void
  'view:write': (name: string, view: object) => void
  'git:status': () => GitStatus
  'git:init': () => GitStatus
  'git:sync': () => Synced
  'git:finish': (resolved: { file: string; text: string }[]) => Synced
  'git:history': (file: string, since: string) => string[]
  'git:setRemote': (url: string) => void
  'engine:pickGame': () => { game?: string; engine: EngineIndex | null }
  'engine:pickGodot': () => string | null
  'engine:open': (path: string, stage?: string) => { ok: boolean; error?: string; started?: boolean }
  'import:pick': () => { files: ImportFile[]; suggested: ImportJob[] }
  'import:preview': (jobs: ImportJob[]) => ImportResult
  'import:commit': (pages: Page[], jobs: ImportJob[]) => ProjectConfig
  'shell:open': (file: string) => void
  'shell:addon': () => void
  'canvas:save': (text: string, name: string) => string | null
  'canvas:open': () => string | null
}
export interface Events {
  'page:changed': (file: string, page: Page | null) => void
  'engine:index': (index: EngineIndex | null) => void
  'bridge:state': (state: BridgeState) => void
  'app:closing': () => void
}
export const EVENTS: (keyof Events)[] = ['page:changed', 'engine:index', 'bridge:state', 'app:closing']
