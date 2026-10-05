// The editor must save exactly what it loaded, so opening a page never changes its file.
import { beforeAll, describe, expect, it } from 'vitest'
import { Window } from 'happy-dom'
import { canonBody } from '../src/shared/page'
import { resolveSchema } from '../src/shared/schema'
import { importDocs } from '../src/main/importer'
import { CONFIG, DIR, JOBS, real, synthetic } from './fixtures'

let roundTrip: (md: string) => string
beforeAll(async () => {
  const w = new Window()
  for (const k of ['window', 'document', 'Node', 'HTMLElement', 'Element', 'DOMParser', 'MutationObserver', 'getComputedStyle'])
    Object.defineProperty(globalThis, k, { value: k === 'window' ? w : k === 'getComputedStyle' ? w.getComputedStyle.bind(w) : (w as any)[k], configurable: true, writable: true })
  const { Editor } = await import('@tiptap/core')
  const { extensions } = await import('../src/shared/markdown')
  const editor = new Editor({ element: document.createElement('div'), extensions, content: '', contentType: 'markdown' })
  roundTrip = (md) => { editor.commands.setContent(md, { contentType: 'markdown' }); return canonBody(editor.getMarkdown()) }
})

export const SAMPLE = `## Description

[[ch_mara_quill|Mara Quill]] asks for help: three boats came back empty to the [[lo_saltmarsh]] quay. The nets were *cut*, not **torn**.

## Expected path

### Approach

Mostly talk and searching.

### Reporting

- Telling Mara keeps it quiet.
- Telling the Guild makes it official.

## Branches

| Condition | Outcome | Pays off in |
| --- | --- | --- |
| Player tells the Guild at once | The Guild notes it and sends no one. | [[se_who_sank_the_meridian]] |
| Player finds the cut ropes | The cave lead is set up a quest earlier. | [[q_mq03]] |
| Player threatens the dock workers | Saltmarsh standing drops. |  |

## Notes

> The empty boats should feel deliberate.
`

describe('markdown round trip', () => {
  it('keeps a real quest page byte for byte', () => expect(roundTrip(SAMPLE)).toBe(SAMPLE))
  it('is stable on a second save', () => expect(roundTrip(roundTrip(SAMPLE))).toBe(SAMPLE))
  it('keeps the new-quest template', () => { const t = resolveSchema().template.quest; expect(roundTrip(t)).toBe(canonBody(t)) })
  it('changes one line for a one-word edit in a table cell', () => {
    const edited = roundTrip(SAMPLE.replace('sends no one', 'sends a clerk'))
    const a = SAMPLE.split('\n'), b = edited.split('\n')
    expect(a.filter((l, i) => l !== b[i]).length).toBe(1)
  })
})

describe('imported pages', () => {
  it('are a fixed point of the editor once normalised', () => {
    const theirs = DIR && CONFIG ? importDocs(real(), CONFIG.import ?? [], resolveSchema(CONFIG), []).pages : []
    for (const p of [...importDocs(synthetic, JOBS, resolveSchema(), []).pages, ...theirs]) { const once = roundTrip(p.body); expect(roundTrip(once)).toBe(once) }
  })
})
