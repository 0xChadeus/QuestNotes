// The lore model: nine page kinds taken from the Broken Wings design documents, and the fields each one carries.
export const TYPES = ['quest', 'questline', 'act', 'character', 'faction', 'district', 'threshold', 'leak', 'mystery'] as const
export type PageType = (typeof TYPES)[number]

export const TYPE_INFO: Record<PageType, { label: string; plural: string; dir: string; prefix: string }> = {
  quest: { label: 'Quest', plural: 'Quests', dir: 'quests', prefix: 'q' },
  questline: { label: 'Questline', plural: 'Questlines', dir: 'questlines', prefix: 'ql' },
  act: { label: 'Act', plural: 'Acts', dir: 'acts', prefix: 'act' },
  character: { label: 'Character', plural: 'Characters', dir: 'characters', prefix: 'ch' },
  faction: { label: 'Faction', plural: 'Factions', dir: 'factions', prefix: 'fa' },
  district: { label: 'District', plural: 'Districts', dir: 'districts', prefix: 'di' },
  threshold: { label: 'Threshold', plural: 'Thresholds', dir: 'thresholds', prefix: 'th' },
  leak: { label: 'Leak channel', plural: 'Leak channels', dir: 'leaks', prefix: 'lc' },
  mystery: { label: 'Mystery', plural: 'Mysteries', dir: 'mysteries', prefix: 'my' },
}

export const STATUSES = ['idea', 'outline', 'draft', 'review', 'ready', 'cut'] as const
export type Status = (typeof STATUSES)[number]
export const STATUS_LABEL: Record<Status, string> = {
  idea: 'Idea', outline: 'Outline', draft: 'Draft', review: 'Review', ready: 'Ready for engine', cut: 'Cut',
}
export const ARCHETYPES = ['aligned', 'divergent', 'exposure']

/** One entry of a list field: a page reference or free text, plus the docs' qualifiers. `none` is an explicit "None". */
export interface Row {
  ref?: string; text?: string; none?: boolean
  note?: string; condition?: string; weight?: string; direction?: string; anchor?: string; vector?: string
}
type Extra = 'note' | 'condition' | 'weight' | 'direction' | 'anchor' | 'vector'
export const EXTRA_OPTIONS: Partial<Record<Extra, string[]>> = {
  direction: ['toward renown', 'toward notoriety', 'up', 'down', 'depends'],
  anchor: ['material', 'identity', 'bond', 'fear', 'belief'],
}

export interface Field {
  key: string; label: string
  kind: 'text' | 'long' | 'select' | 'ref' | 'rows' | 'tags' | 'number' | 'subsection'
  to?: PageType[]; extras?: Extra[]; options?: string[]; optional?: boolean; effect?: boolean
}

const rows = (key: string, label: string, to: PageType[], extras: Extra[], more: Partial<Field> = {}): Field =>
  ({ key, label, kind: 'rows', to, extras, ...more })
const aliases: Field = { key: 'aliases', label: 'Aliases', kind: 'tags' }

export const FIELDS: Record<PageType, Field[]> = {
  quest: [
    { key: 'act', label: 'Act', kind: 'ref', to: ['act'] },
    { key: 'subsection', label: 'Sub-section', kind: 'subsection' },
    { key: 'questline', label: 'Questline', kind: 'ref', to: ['questline'] },
    rows('issuer', 'Issuer', ['character'], ['note']),
    rows('sanctioning', 'Sanctioning sub-factions', ['faction'], ['note']),
    rows('exposed', 'Exposed characters', ['character', 'faction'], ['weight', 'condition', 'note']),
    rows('renown', 'Renown impact', ['district'], ['direction', 'note'], { effect: true }),
    rows('anchor_pressure', 'Anchor pressure', ['character'], ['anchor', 'note'], { effect: true }),
    rows('morale', 'Morale impact', ['character'], ['direction', 'note'], { effect: true }),
    rows('thresholds', 'Threshold contributions', ['threshold'], ['vector', 'note'], { effect: true }),
    rows('leaks', 'Leak channels', ['leak', 'character'], ['condition'], { effect: true }),
    rows('leads_to', 'Leads to', ['quest'], ['note']),
    { key: 'time_pressure', label: 'Time pressure', kind: 'text', optional: true },
    rows('companions', 'Companion availability', ['character'], ['note'], { optional: true }),
  ],
  questline: [{ key: 'kind', label: 'Kind', kind: 'select', options: ['main', 'side', 'emergent'] }, { key: 'order', label: 'Order', kind: 'number' }],
  act: [{ key: 'order', label: 'Order', kind: 'number' }, { key: 'subsections', label: 'Sub-sections', kind: 'tags' }],
  character: [
    aliases,
    { key: 'tier', label: 'Tier', kind: 'select', options: ['principal', 'side', 'named only'] },
    { key: 'district', label: 'District', kind: 'ref', to: ['district'] },
    rows('factions', 'Factions', ['faction'], ['note']),
    rows('anchors', 'Anchors', [], ['anchor', 'note']),
    { key: 'role_in_play', label: 'Role in play', kind: 'long', optional: true },
  ],
  faction: [aliases, { key: 'parent', label: 'Part of', kind: 'ref', to: ['faction'] }],
  district: [aliases, { key: 'area_id', label: 'Engine area id', kind: 'text', optional: true }],
  threshold: [aliases, { key: 'resolves_in', label: 'Resolves in', kind: 'ref', to: ['quest'], optional: true }],
  leak: [aliases, { key: 'owner', label: 'Run by', kind: 'ref', to: ['character', 'faction'] }],
  mystery: [aliases, rows('known_by', 'Who knows', ['character', 'faction'], ['note'])],
}

/** Quest completeness, as the Quest Index defines a finished entry: 9 schema fields, a description, 3 vectors, a branch. */
export const REQUIRED_QUEST_FIELDS = ['act', 'issuer', 'sanctioning', 'exposed', 'renown', 'anchor_pressure', 'morale', 'thresholds']
export const QUEST_TEMPLATE = `## Description

## Execution vectors

### Method

### Collateral

### Disclosure

## Branching surfaces

| Branch condition | Outcome | Pays off in |
| --- | --- | --- |
|  |  |  |

## Developer note
`
