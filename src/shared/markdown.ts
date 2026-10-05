// TipTap extensions shared by the editor and the round-trip tests: [[id|label]] links and one-line-per-row tables.
import { Node } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { TableKit, Table } from '@tiptap/extension-table'

export const WikiLink = Node.create({
  name: 'wikiLink', group: 'inline', inline: true, atom: true, selectable: true,
  addAttributes: () => ({ id: { default: null }, label: { default: null } }),
  parseHTML: () => [{ tag: 'a[data-wiki]', getAttrs: (el) => ({ id: (el as HTMLElement).dataset.wiki }) }],
  renderHTML: ({ node }) => ['a', { 'data-wiki': node.attrs.id, class: 'wiki' }, node.attrs.label ?? node.attrs.id],
  markdownTokenizer: {
    name: 'wikiLink', level: 'inline', start: (s: string) => s.indexOf('[['),
    tokenize(s: string) {
      const m = /^\[\[([a-z0-9_/-]+)(?:\|([^\]]+))?\]\]/.exec(s)
      return m ? { type: 'wikiLink', raw: m[0], id: m[1], label: m[2] ?? null } : undefined
    },
  },
  parseMarkdown: (t: any, h: any) => h.createNode('wikiLink', { id: t.id, label: t.label }),
  renderMarkdown: (n: any) => `[[${n.attrs.id}${n.attrs.label ? '|' + n.attrs.label : ''}]]`,
})

/** A table row per line with no column padding, so editing one cell changes one line of the file. */
const CompactTable = Table.extend({
  renderMarkdown(node: any, h: any) {
    const rows: string[][] = (node.content ?? []).map((r: any) => (r.content ?? []).map((c: any) =>
      h.renderChildren(c.content ?? []).trim().replace(/\n+/g, ' ').replace(/(?<!\\)\|/g, '\\|')))
    if (!rows.length) return ''
    const line = (cells: string[]) => `| ${cells.join(' | ')} |`
    return [line(rows[0]), line(rows[0].map(() => '---')), ...rows.slice(1).map(line)].join('\n')
  },
})

export const extensions = [StarterKit.configure({ link: { openOnClick: false } }), TableKit.configure({ table: false }), CompactTable.configure({ resizable: false }), WikiLink, Markdown]
