// The link to a game engine's quest system, read-only: where its quest files are, which keys hold the id, title, kind
// and stages, and where its character ids live. A project names its engine in questnotes.yaml; presets fill it in.
import type { Data } from './page'

export interface EngineConfig {
  /** A built-in engine whose settings this one starts from; any key given here overrides the preset's. */
  preset?: string
  name: string
  quests?: { files: string; id?: string; title?: string; kind?: string; stages?: string; stage_id?: string; kinds?: string[]; new_path?: string; id_pattern?: string }
  characters?: { files: string; id_pattern: string }
  /** Godot editors only: the QuestNotes Bridge adapter that opens a quest, and how the editor names project paths. */
  adapter?: string; res_prefix?: string
}

export const ENGINE_PRESETS: Record<string, EngineConfig> = {
  animus: {
    name: 'Animus', adapter: 'animus', res_prefix: 'res://',
    quests: { files: 'resources/quests/**/*.json', id: 'quest_id', title: 'title', kind: 'kind', stages: 'stages', stage_id: 'id', kinds: ['main', 'side', 'emergent'], new_path: 'res://resources/quests/{kind}/{id}.json', id_pattern: '^[a-z0-9_]+$' },
    characters: { files: 'resources/npc/**/*.tres', id_pattern: 'character_id\\s*=\\s*"([^"]+)"' },
  },
}

export function resolveEngine(e?: Partial<EngineConfig>): EngineConfig | undefined {
  if (!e) return undefined
  const base = ENGINE_PRESETS[e.preset ?? '']
  return { ...base, ...e, name: e.name ?? base?.name ?? 'the engine' }
}

export interface EngineQuest { path: string; kind: string; title: string; stages: string[]; stub: boolean }
export interface EngineIndex { scanned: string; source: 'game' | 'snapshot'; quests: Record<string, EngineQuest[]>; characters: string[] }

export type QuestState = 'unknown' | 'none' | 'needs' | 'link' | 'stub' | 'built' | 'missing' | 'duplicate'
export const STATE_TONE: Record<QuestState, 'grey' | 'amber' | 'blue' | 'green' | 'red'> = {
  unknown: 'grey', none: 'grey', needs: 'amber', link: 'blue', stub: 'green', built: 'green', missing: 'red', duplicate: 'red',
}
export const stateLabel = (s: QuestState, engine = 'engine', hits?: EngineQuest[]) => ({
  unknown: 'No engine data', none: 'Not in engine', needs: `Needs creating in ${engine}`, link: 'Link?', stub: `In ${engine} (stub)`,
  built: hits?.[0] ? `In ${engine} · ${hits[0].stages.length} stages` : `In ${engine}`, missing: `Missing in ${engine}`, duplicate: 'Duplicate id',
})[s]

export function questState(q: Data, index: EngineIndex | null): QuestState {
  if (!index) return 'unknown'
  const a = q.engine ?? {}
  const hits = a.id ? index.quests[a.id] ?? [] : []
  if (hits.length > 1) return 'duplicate'
  if (hits.length) return a.linked_on ? (hits[0].stub ? 'stub' : 'built') : 'link'
  if (a.linked_on) return 'missing'
  return q.status === 'ready' ? 'needs' : 'none'
}

/** A character needs to exist in the engine only when a Ready quest names them as its giver. */
export function characterState(c: Data, index: EngineIndex | null, neededByReady: boolean): 'unknown' | 'in' | 'needs' | 'none' {
  if (!index) return 'unknown'
  if (c.engine?.id && index.characters.includes(c.engine.id)) return 'in'
  return neededByReady ? 'needs' : 'none'
}

/** An engine character this page probably is, when nobody has linked one yet: a word of its name or aliases. */
export function suggestCharacterId(c: Data, index: EngineIndex | null) {
  if (!index || c.engine?.id) return undefined
  const names = [c.title, ...(c.aliases ?? [])].flatMap((n: string) => n.toLowerCase().split(/\s+/))
  return index.characters.find((id) => names.includes(id))
}

/** Quests open in the engine's editor through the QuestNotes Bridge, which Godot projects (res:// paths) can install. */
export const opensInEditor = (e?: EngineConfig) => !!e?.res_prefix?.startsWith('res://')

export const suggestQuestId = (code: string, title: string) => (code || title).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
export const questPath = (e: EngineConfig | undefined, kind: string, id: string) => (e?.quests?.new_path ?? '{id}').replace('{kind}', kind).replace('{id}', id)
