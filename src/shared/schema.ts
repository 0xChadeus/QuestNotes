// The lore model. Quests, questlines and acts are built in; every other page kind, and the fields of every kind, come
// from the project's questnotes.yaml, over a general default.
import { resolveEngine, type EngineConfig } from './engine'

export const STATUSES = ['idea', 'outline', 'draft', 'review', 'ready', 'cut'] as const
export type Status = (typeof STATUSES)[number]
export const STATUS_LABEL: Record<Status, string> = {
  idea: 'Idea', outline: 'Outline', draft: 'Draft', review: 'Review', ready: 'Ready for engine', cut: 'Cut',
}

/** One entry of a list field: a page reference or free text, plus qualifiers named by the field. `none` is an explicit "None". */
export type Row = { ref?: string; text?: string; none?: boolean } & Record<string, any>
export type Extra = string | { key: string; options: string[] }

export interface Field {
  key: string; label: string
  kind: 'text' | 'long' | 'select' | 'ref' | 'rows' | 'tags' | 'number' | 'subsection'
  to?: string[]; extras?: Extra[]; options?: string[]
  optional?: boolean; required?: boolean; effect?: boolean; giver?: boolean
  glyph?: string; aliases?: string[]
}
export interface Kind { id: string; label: string; plural: string; prefix: string; dir: string; color?: string }

/** How design documents become pages; see the import dialog. */
export interface ImportJob {
  file: string; kind: string
  level?: number; under?: string; match?: string; skip?: string; pattern?: string
  group?: { field: string; skip?: string }; set?: Record<string, unknown>; hooks?: string; create?: string[]
  /** Extra names for pages by title, so prose that says "the Guild" finds "The Guild of the Fallen". */
  aliases?: Record<string, string[]>
}

export interface ProjectConfig {
  name?: string
  kinds?: (Partial<Kind> & { id: string; label: string })[]
  fields?: Record<string, Field[]>
  template?: Record<string, string>
  required_sections?: string[]
  branches?: string
  matrix?: { kind: string; field: string; title: string }
  engine?: Partial<EngineConfig>
  import?: ImportJob[]
}

export interface Schema {
  kinds: Kind[]; fields: Record<string, Field[]>; template: Record<string, string>
  required: string[]; branches: string; matrix?: ProjectConfig['matrix']; engine?: EngineConfig
}

const BUILTIN: Kind[] = [
  { id: 'quest', label: 'Quest', plural: 'Quests', prefix: 'q', dir: 'quests', color: '#9a3b22' },
  { id: 'questline', label: 'Questline', plural: 'Questlines', prefix: 'ql', dir: 'questlines' },
  { id: 'act', label: 'Act', plural: 'Acts', prefix: 'act', dir: 'acts' },
]
const rows = (key: string, label: string, to: string[], extras: Extra[], more: Partial<Field> = {}): Field => ({ key, label, kind: 'rows', to, extras, ...more })
const aliases: Field = { key: 'aliases', label: 'Aliases', kind: 'tags' }

export const DEFAULT_CONFIG: ProjectConfig = {
  kinds: [
    { id: 'character', label: 'Character', prefix: 'ch', color: '#a0607a' }, { id: 'faction', label: 'Faction', prefix: 'fa', color: '#b38b35' },
    { id: 'location', label: 'Location', prefix: 'lo', color: '#5f8a5a' }, { id: 'secret', label: 'Secret', prefix: 'se', color: '#2c5d74' },
  ],
  fields: {
    quest: [
      rows('giver', 'Quest giver', ['character'], ['note'], { giver: true, required: true, glyph: 'G' }),
      rows('involved', 'Involved', ['character', 'faction'], ['condition', 'note'], { glyph: 'I' }),
      rows('locations', 'Locations', ['location'], ['note']),
      rows('factions', 'Faction standing', ['faction'], [{ key: 'direction', options: ['up', 'down', 'depends'] }, 'note'], { effect: true }),
      rows('reveals', 'Reveals', ['secret'], ['note'], { effect: true }),
      { key: 'requirements', label: 'Requirements', kind: 'long', optional: true },
      { key: 'rewards', label: 'Rewards', kind: 'long', optional: true },
    ],
    character: [aliases, { key: 'role', label: 'Role', kind: 'select', options: ['major', 'minor', 'named only'] }, { key: 'faction', label: 'Faction', kind: 'ref', to: ['faction'] }, { key: 'home', label: 'Home', kind: 'ref', to: ['location'] }],
    faction: [aliases, { key: 'parent', label: 'Part of', kind: 'ref', to: ['faction'] }],
    location: [aliases, { key: 'parent', label: 'Part of', kind: 'ref', to: ['location'] }],
    secret: [aliases, rows('known_by', 'Who knows', ['character', 'faction'], ['note'])],
  },
  template: { quest: '## Description\n\n## Expected path\n\n## Branches\n\n| Condition | Outcome | Pays off in |\n| --- | --- | --- |\n|  |  |  |\n\n## Notes\n' },
  required_sections: ['Description', 'Expected path', 'Branches'],
  branches: 'Branches',
}

export function resolveSchema(c: ProjectConfig = {}): Schema {
  const custom = !!c.kinds
  const kinds = [...BUILTIN, ...(c.kinds ?? DEFAULT_CONFIG.kinds!).filter((k) => !BUILTIN.some((b) => b.id === k.id))
    .map((k) => ({ plural: `${k.label}s`, prefix: k.id.slice(0, 3), dir: `${k.id}s`, ...k }))]
  const ids = new Set(kinds.map((k) => k.id))
  const given = c.fields ?? (custom ? {} : DEFAULT_CONFIG.fields!)
  const known = (fs: Field[]) => fs.map((f) => (f.to ? { ...f, to: f.to.filter((t) => ids.has(t)) } : f))
  const fields: Record<string, Field[]> = {
    quest: known([{ key: 'act', label: 'Act', kind: 'ref', to: ['act'] }, { key: 'subsection', label: 'Sub-section', kind: 'subsection' },
      { key: 'questline', label: 'Questline', kind: 'ref', to: ['questline'] }, ...(given.quest ?? []), rows('leads_to', 'Leads to', ['quest'], ['note'])]),
    questline: [{ key: 'kind', label: 'Kind', kind: 'select', options: ['main', 'side', 'emergent'] }, { key: 'order', label: 'Order', kind: 'number' }],
    act: [{ key: 'order', label: 'Order', kind: 'number' }, { key: 'subsections', label: 'Sub-sections', kind: 'tags' }],
  }
  for (const k of kinds) if (!fields[k.id]) fields[k.id] = known(given[k.id] ?? [aliases])
  return {
    kinds, fields, engine: resolveEngine(c.engine), matrix: c.matrix && ids.has(c.matrix.kind) ? c.matrix : undefined,
    template: { ...(custom ? {} : DEFAULT_CONFIG.template), ...c.template },
    required: c.required_sections ?? (custom ? [] : DEFAULT_CONFIG.required_sections!),
    branches: c.branches ?? DEFAULT_CONFIG.branches!,
  }
}

export const kindOf = (s: Schema, id: string) => s.kinds.find((k) => k.id === id)
export const extraKey = (x: Extra) => (typeof x === 'string' ? x : x.key)
/** The kind of page the cast matrix lists: whatever a quest giver is, characters by default. */
export const castKind = (s: Schema) => s.fields.quest.find((f) => f.giver)?.to?.[0] ?? 'character'
export const giverField = (s: Schema) => s.fields.quest.find((f) => f.giver)
/** The rows fields of quests that name characters, with the letter the cast matrix shows for each. */
export const castFields = (s: Schema, kind = castKind(s)) =>
  (s.fields.quest ?? []).filter((f) => f.kind === 'rows' && f.to?.includes(kind) && f.key !== 'leads_to').map((f) => ({ ...f, glyph: f.glyph ?? f.label[0].toUpperCase() }))
