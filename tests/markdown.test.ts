// The editor must save exactly what it loaded, so opening a page never changes its file.
import { beforeAll, describe, expect, it } from 'vitest'
import { Window } from 'happy-dom'
import { canonBody } from '../src/shared/page'
import { QUEST_TEMPLATE } from '../src/shared/schema'
import { importDocs } from '../src/main/importer'
import { docs } from './fixtures'

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

[[ch_lyra_frost|Lyra Frost]] approaches Ed about four of her girls found dead in an [[di_ashfield]] alley. The scene is *arranged*, not **scattered**.

## Execution vectors

### Method

Almost entirely social and investigative.

### Disclosure

- Reporting fully to Lyra is the path of least resistance.
- Reporting to Marcus elevates the case.

## Branching surfaces

| Branch condition | Outcome | Pays off in |
| --- | --- | --- |
| Player reports to Marcus immediately | Marcus notes the case but assigns no resources. | [[th_conspiracy]] |
| Player finds the vertical blood trail | The Undercity connection is seeded a quest earlier. | [[q_mq03]] |
| Player rough-handles witnesses | Ashfield Renown moves toward Notoriety. |  |

## Developer note

> The crime scene should feel disturbing in its deliberateness.
`

describe('markdown round trip', () => {
  it('keeps a real quest page byte for byte', () => expect(roundTrip(SAMPLE)).toBe(SAMPLE))
  it('is stable on a second save', () => expect(roundTrip(roundTrip(SAMPLE))).toBe(SAMPLE))
  it('keeps the new-quest template', () => expect(roundTrip(QUEST_TEMPLATE)).toBe(canonBody(QUEST_TEMPLATE)))
  it('changes one line for a one-word edit in a table cell', () => {
    const edited = roundTrip(SAMPLE.replace('assigns no resources', 'assigns few resources'))
    const a = SAMPLE.split('\n'), b = edited.split('\n')
    expect(a.filter((l, i) => l !== b[i]).length).toBe(1)
  })
})

describe('imported pages', () => {
  it('are a fixed point of the editor once normalised', () => {
    for (const p of importDocs(docs(), []).pages) { const once = roundTrip(p.body); expect(roundTrip(once)).toBe(once) }
  })
})
