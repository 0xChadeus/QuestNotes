// What Animus holds, as scanned read-only from the game repo, and the badge each lore page shows for it.
import type { Data } from './page'

export interface EngineQuest { path: string; kind: string; title: string; stages: string[]; stub: boolean }
export interface EngineIndex { scanned: string; source: 'game' | 'snapshot'; quests: Record<string, EngineQuest[]>; characters: string[] }

export type QuestState = 'unknown' | 'none' | 'needs' | 'link' | 'stub' | 'built' | 'missing' | 'duplicate'
export const STATE_LABEL: Record<QuestState, string> = {
  unknown: 'No engine data', none: 'Not in engine', needs: 'Needs creating in Animus', link: 'Link?',
  stub: 'In Animus (stub)', built: 'In Animus', missing: 'Missing in Animus', duplicate: 'Duplicate id',
}
export const STATE_TONE: Record<QuestState, 'grey' | 'amber' | 'blue' | 'green' | 'red'> = {
  unknown: 'grey', none: 'grey', needs: 'amber', link: 'blue', stub: 'green', built: 'green', missing: 'red', duplicate: 'red',
}

export const QUEST_ID = /^[a-z0-9_]+$/

export function questState(q: Data, index: EngineIndex | null): QuestState {
  if (!index) return 'unknown'
  const a = q.animus ?? {}
  const hits = a.quest_id ? index.quests[a.quest_id] ?? [] : []
  if (hits.length > 1) return 'duplicate'
  if (hits.length) return a.linked_on ? (hits[0].stub ? 'stub' : 'built') : 'link'
  if (a.linked_on) return 'missing'
  return q.status === 'ready' ? 'needs' : 'none'
}

export const questBadge = (s: QuestState, hits?: EngineQuest[]) =>
  s === 'built' && hits?.[0] ? `In Animus · ${hits[0].stages.length} stages` : STATE_LABEL[s]

/** A character needs a unique in the engine only when a Ready quest names them as issuer. */
export function characterState(c: Data, index: EngineIndex | null, neededByReady: boolean): 'unknown' | 'in' | 'needs' | 'none' {
  if (!index) return 'unknown'
  const id = c.animus?.character_id
  if (id && index.characters.includes(id)) return 'in'
  return neededByReady ? 'needs' : 'none'
}

/** An engine character this page probably is, when nobody has linked one yet: a name or alias, lower-cased. */
export function suggestCharacterId(c: Data, index: EngineIndex | null) {
  if (!index || c.animus?.character_id) return undefined
  const names = [c.title, ...(c.aliases ?? [])].flatMap((n: string) => n.toLowerCase().split(/\s+/))
  return index.characters.find((id) => names.includes(id))
}

export const suggestQuestId = (code: string, title: string) =>
  (code || title).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
