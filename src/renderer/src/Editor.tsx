// The page body: TipTap over Markdown. @ or [[ links a page, / inserts a block. Saves on a pause in typing.
import { useEffect, useRef } from 'react'
import { useEditor, EditorContent, type Editor as TEditor } from '@tiptap/react'
import { Editor as Core, Extension, type Range } from '@tiptap/core'
import Suggestion, { type SuggestionOptions } from '@tiptap/suggestion'
import { PluginKey } from '@tiptap/pm/state'
import { extensions, WikiLink } from '../../shared/markdown'
import { canonBody, type Page } from '../../shared/page'
import { useStore, update, peek, createPage } from './store'
import { label } from './derive'
import { castKind, kindOf } from '../../shared/schema'

interface Item { label: string; run: (e: TEditor, r: Range) => void }

/** A minimal suggestion list: arrows, Enter, Escape. */
function popup(): SuggestionOptions<Item>['render'] {
  return () => {
    let el: HTMLDivElement, items: Item[] = [], i = 0, pick: (it: Item) => void
    const draw = () => {
      el.replaceChildren(...items.map((it, n) => Object.assign(document.createElement('div'), {
        className: `opt${n === i ? ' on' : ''}`, textContent: it.label, onmousedown: (e: Event) => { e.preventDefault(); pick(it) },
      })))
    }
    const sync = (p: any) => {
      items = p.items; pick = (it) => p.command(it); i = Math.min(i, Math.max(items.length - 1, 0)); draw()
      const r = p.clientRect?.()
      if (r) Object.assign(el.style, { left: `${r.left}px`, top: `${r.bottom + 4}px`, display: items.length ? 'block' : 'none' })
    }
    return {
      onStart: (p) => { el = Object.assign(document.createElement('div'), { className: 'suggest' }); document.body.append(el); i = 0; sync(p) },
      onUpdate: sync,
      onKeyDown: ({ event }) => {
        if (event.key === 'ArrowDown') i = (i + 1) % Math.max(items.length, 1)
        else if (event.key === 'ArrowUp') i = (i - 1 + items.length) % Math.max(items.length, 1)
        else if (event.key === 'Enter' && items[i]) pick(items[i])
        else if (event.key === 'Escape') el.remove()
        else return false
        draw(); return true
      },
      onExit: () => el.remove(),
    }
  }
}

const link = (id: string) => (e: TEditor, r: Range) => e.chain().focus().insertContentAt(r, [{ type: 'wikiLink', attrs: { id } }, { type: 'text', text: ' ' }]).run()
function mentionItems({ query }: { query: string }): Item[] {
  const { pages, recent, schema } = useStore.getState()
  const q = query.toLowerCase()
  const hits = Object.values(pages).filter((p) => `${p.data.code ?? ''} ${p.data.title} ${(p.data.aliases ?? []).join(' ')}`.toLowerCase().includes(q))
  hits.sort((a, b) => (recent.indexOf(b.data.id) + 1) - (recent.indexOf(a.data.id) + 1) || a.data.title.length - b.data.title.length)
  const items: Item[] = hits.slice(0, 8).map((p) => ({ label: label(pages, p.data.id), run: link(p.data.id) }))
  const kind = kindOf(schema, castKind(schema))
  if (query.trim() && kind) items.push({ label: `New ${kind.label.toLowerCase()} “${query.trim()}”`, run: async (e, r) => link(await createPage(kind.id, query.trim()))(e, r) })
  return items
}
const block = (name: string, run: (e: TEditor) => void): Item => ({ label: name, run: (e, r) => { e.chain().focus().deleteRange(r).run(); run(e) } })
const BLOCKS = [
  block('Heading', (e) => e.chain().toggleHeading({ level: 2 }).run()),
  block('Subheading', (e) => e.chain().toggleHeading({ level: 3 }).run()),
  block('Bullet list', (e) => e.chain().toggleBulletList().run()),
  block('Numbered list', (e) => e.chain().toggleOrderedList().run()),
  block('Quote', (e) => e.chain().toggleBlockquote().run()),
  block('Table', (e) => e.chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()),
  block('Branch table', (e) => e.chain().insertContent(`<h2>${useStore.getState().schema.branches}</h2><table><tr><th>Condition</th><th>Outcome</th><th>Pays off in</th></tr><tr><td></td><td></td><td></td></tr></table>`).run()),
]

const suggest = (char: string, items: SuggestionOptions<Item>['items']) => (editor: TEditor) => Suggestion<Item>({
  editor, char, allowSpaces: char !== '/', pluginKey: new PluginKey(`suggest${char}`), items, render: popup(),
  command: ({ editor: e, range, props }) => props.run(e, range),
})
const Suggestions = Extension.create({
  name: 'suggestions',
  addProseMirrorPlugins() {
    return [suggest('@', mentionItems)(this.editor), suggest('[[', mentionItems)(this.editor),
      suggest('/', ({ query }) => BLOCKS.filter((b) => b.label.toLowerCase().startsWith(query.toLowerCase())))(this.editor)]
  },
})

/** Shows a link by the page's current title, so renaming a page never breaks or stales a mention. */
const LiveLink = WikiLink.extend({
  addNodeView: () => ({ node }) => {
    const { pages } = useStore.getState()
    const dom = Object.assign(document.createElement('a'), { className: pages[node.attrs.id] ? 'wiki' : 'wiki missing', textContent: label(pages, node.attrs.id) })
    dom.onclick = () => pages[node.attrs.id] && peek(node.attrs.id)
    return { dom }
  },
})
const EXT = [...extensions.filter((e) => e.name !== 'wikiLink'), LiveLink, Suggestions]

export function Editor({ id }: { id: string }) {
  const body = useStore((s) => s.pages[id]?.body ?? '')
  const last = useRef(body)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const flush = useRef<() => void>(() => {})
  const editor = useEditor({
    extensions: EXT, content: body, contentType: 'markdown',
    onUpdate: ({ editor: e }) => {
      flush.current = () => {
        const md = canonBody(e.getMarkdown())
        if (md !== last.current) { last.current = md; update(id, (p) => ({ ...p, body: md })) }
      }
      clearTimeout(timer.current)
      timer.current = setTimeout(() => flush.current(), 500)
    },
  }, [id])
  useEffect(() => () => { clearTimeout(timer.current); flush.current() }, [id])
  useEffect(() => {
    if (editor && body !== last.current && !editor.isFocused) { last.current = body; editor.commands.setContent(body, { contentType: 'markdown' }) }
  }, [body, editor])
  return <EditorContent editor={editor} className="prose" spellCheck />
}

/** Imported bodies are stored in the editor's own Markdown form, so opening a page never rewrites its file. */
export function normalizeBodies(pages: Page[]) {
  const e = new Core({ extensions, content: '', contentType: 'markdown' })
  const out = pages.map((p) => { e.commands.setContent(p.body, { contentType: 'markdown' }); return { ...p, body: canonBody(e.getMarkdown()) } })
  e.destroy()
  return out
}
