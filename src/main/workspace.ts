// The lore folder: questnotes.yaml, one Markdown page per entity, atomic saves, and a watcher that ignores the app's own writes.
import { promises as fs, existsSync, watch, type FSWatcher } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { parse } from 'yaml'
import { parsePage, writePage, writeYaml, type Page } from '../shared/page'
import { resolveSchema, type ProjectConfig, type Schema } from '../shared/schema'

const hash = (s: string) => createHash('sha1').update(s).digest('hex')

export class Workspace {
  config: ProjectConfig = {}
  schema: Schema = resolveSchema()
  private own = new Map<string, string>()
  private watchers = new Map<string, FSWatcher>()
  private pending = new Map<string, NodeJS.Timeout>()
  constructor(readonly root: string) {}

  static async create(root: string, name: string) {
    await fs.mkdir(root, { recursive: true })
    await fs.writeFile(path.join(root, 'questnotes.yaml'), writeYaml({ name }))
    await fs.writeFile(path.join(root, '.gitattributes'), '* text=auto eol=lf\n')
  }

  async loadConfig() {
    this.config = (await this.readYaml('questnotes.yaml')) ?? {}
    this.config.name ??= path.basename(this.root)
    this.schema = resolveSchema(this.config)
  }
  async saveConfig(config: ProjectConfig) {
    await this.writeText('questnotes.yaml', writeYaml(config))
    await this.loadConfig()
  }

  private dirs = () => this.schema.kinds.map((k) => k.dir)
  private byDir = () => Object.fromEntries(this.schema.kinds.map((k) => [k.dir, k.id]))
  async loadAll() {
    const pages: Page[] = []
    const errors: { file: string; error: string }[] = []
    for (const dir of this.dirs()) {
      for (const n of (await fs.readdir(this.abs(dir)).catch(() => [] as string[])).filter((n) => n.endsWith('.md'))) {
        const file = `${dir}/${n}`
        try { pages.push(parsePage(await fs.readFile(this.abs(file), 'utf8'), file, this.byDir())) } catch (e) { errors.push({ file, error: String(e) }) }
      }
    }
    // Pages in a folder no kind uses (a kind removed from questnotes.yaml, say) would otherwise vanish without a word.
    for (const e of await fs.readdir(this.root, { withFileTypes: true }).catch(() => [])) {
      if (!e.isDirectory() || e.name.startsWith('.') || ['trash', 'views', 'engine', ...this.dirs()].includes(e.name)) continue
      const n = (await fs.readdir(this.abs(e.name)).catch(() => [] as string[])).filter((x) => x.endsWith('.md')).length
      if (n) errors.push({ file: `${e.name}/`, error: `${n} page${n > 1 ? 's are' : ' is'} hidden: no kind in questnotes.yaml uses the folder “${e.name}”` })
    }
    return { pages, errors }
  }

  async writeText(file: string, text: string) {
    const abs = this.abs(file)
    await fs.mkdir(path.dirname(abs), { recursive: true })
    this.own.set(file, hash(text))
    const tmp = `${abs}.${process.pid}.tmp`
    await fs.writeFile(tmp, text)
    await fs.rename(tmp, abs)
  }
  write = (p: Page) => this.writeText(p.file, writePage(p.data, p.body))

  /** Moves a file, never over another one. */
  async move(from: string, to: string) {
    if (await fs.access(this.abs(to)).then(() => true, () => false)) throw new Error(`${to} already exists`)
    await fs.mkdir(path.dirname(this.abs(to)), { recursive: true })
    this.own.set(from, 'gone')
    await fs.rename(this.abs(from), this.abs(to))
  }
  /** Moves a page to the Trash and says where it went: a second page with the same name gets a ~2, ~3… so both are kept. */
  async trash(file: string) {
    let to = file
    for (let n = 2; await fs.access(this.abs(`trash/${to}`)).then(() => true, () => false); n++) to = file.replace(/\.md$/, `~${n}.md`)
    await this.move(file, `trash/${to}`)
    return to
  }
  /** Puts a page back from the Trash under its own name; refuses when a live page has that name. */
  restore = (trashed: string, to = trashed.replace(/~\d+\.md$/, '.md')) => this.move(`trash/${trashed}`, to)
  async trashed() {
    const out: Page[] = []
    for (const dir of this.dirs()) for (const n of await fs.readdir(this.abs(`trash/${dir}`)).catch(() => [] as string[]))
      try { out.push(parsePage(await fs.readFile(this.abs(`trash/${dir}/${n}`), 'utf8'), `${dir}/${n}`, this.byDir())) } catch { /* skip */ }
    return out
  }
  emptyTrash = () => fs.rm(this.abs('trash'), { recursive: true, force: true })
  /** Deletes a page for good: a page created and then undone, or one picked from the Trash. */
  async remove(file: string) { this.own.set(file, 'gone'); await fs.rm(this.abs(file), { force: true }) }
  removeTrashed = (file: string) => fs.rm(this.abs(`trash/${file}`), { force: true })

  async readYaml(file: string) { try { return parse(await fs.readFile(this.abs(file), 'utf8')) } catch { return null } }
  writeYaml = (file: string, obj: object) => this.writeText(file, writeYaml(obj))

  /** Reports page files changed by anything other than this app: git, an external editor, another tool. One watcher per page
   *  folder: Node's recursive watching on Linux loses a file once it is replaced by a rename, which is how this app and git write. */
  watch(onChange: (file: string, page: Page | null) => void) {
    const attach = (dir: string) => {
      this.watchers.get(dir)?.close()
      this.watchers.delete(dir)
      if (!existsSync(this.abs(dir))) return
      this.watchers.set(dir, watch(this.abs(dir), (_e, n) => { const name = n?.toString(); if (name?.endsWith('.md')) this.changed(`${dir}/${name}`, onChange) })
        .on('error', () => this.watchers.delete(dir)))
    }
    this.dirs().forEach(attach)
    // A page folder that appears later (the first character, say) is watched from then on; none is created just to watch it.
    this.watchers.set('', watch(this.root, (_e, n) => { const d = n?.toString(); if (d && this.dirs().includes(d)) attach(d) }).on('error', () => {}))
  }
  private changed(file: string, onChange: (file: string, page: Page | null) => void) {
    clearTimeout(this.pending.get(file))
    this.pending.set(file, setTimeout(async () => {
      const text = await fs.readFile(this.abs(file), 'utf8').catch(() => null)
      if (text === null) { if (this.own.get(file) !== 'gone') onChange(file, null); return }
      if (this.own.get(file) === hash(text)) return
      this.own.set(file, hash(text))
      try { onChange(file, parsePage(text, file, this.byDir())) } catch { /* half-written file; the next event will read it */ }
    }, 120))
  }
  close() { this.watchers.forEach((w) => w.close()); this.watchers.clear() }
  abs = (file: string) => path.join(this.root, file)
}
