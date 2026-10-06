// Tidy: lays out a set of quests left to right with ELK's layered algorithm, keeping their rough order (the interactive
// strategies read the current positions), and puts the result with its top-left corner at `origin`. Loaded on first use.
import type { ElkNode } from 'elkjs/lib/elk-api'
import { CARD_H, CARD_W, type MapNode } from '../../shared/map'

export async function layered(ids: string[], links: [string, string][], now: Map<string, MapNode>, origin: { x: number; y: number }) {
  const { default: ELK } = await import('elkjs/lib/elk.bundled.js')
  const inside = new Set(ids)
  const graph: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered', 'elk.direction': 'RIGHT', 'elk.spacing.nodeNode': '40', 'elk.layered.spacing.nodeNodeBetweenLayers': '80',
      'elk.layered.layering.strategy': 'INTERACTIVE', 'elk.layered.crossingMinimization.strategy': 'INTERACTIVE',
    },
    children: ids.map((id) => ({ id, width: CARD_W, height: CARD_H, x: now.get(id)?.x ?? 0, y: now.get(id)?.y ?? 0 })),
    edges: links.filter(([s, t]) => s !== t && inside.has(s) && inside.has(t)).map(([s, t], i) => ({ id: `e${i}`, sources: [s], targets: [t] })),
  }
  const out = (await new ELK().layout(graph)).children ?? []
  const [x0, y0] = [Math.min(...out.map((c) => c.x ?? 0)), Math.min(...out.map((c) => c.y ?? 0))]
  return Object.fromEntries(out.map((c) => [c.id, { x: Math.round(origin.x + (c.x ?? 0) - x0), y: Math.round(origin.y + (c.y ?? 0) - y0) }]))
}
