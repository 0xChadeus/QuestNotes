// The lore folder: questnotes.yaml, one Markdown page per entity, atomic saves, and a watcher that ignores the app's own writes.
import { promises as fs, watch, type FSWatcher } from 'node:fs'
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
  private watcher?: FSWatcher
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
  async loadAll() {
    const pages: Page[] = []
    const errors: { file: string; error: string }[] = []
    for (const dir of this.dirs()) {
      for (const n of (await fs.readdir(this.abs(dir)).catch(() => [] as string[])).filter((n) => n.endsWith('.md'))) {
        const file = `${dir}/${n}`
        try { pages.push(parsePage(await fs.readFile(this.abs(file), 'utf8'), file)) } catch (e) { errors.push({ file, error: String(e) }) }
      }
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

  async move(from: string, to: string) {
    await fs.mkdir(path.dirname(this.abs(to)), { recursive: true })
    this.own.set(from, 'gone')
    await fs.rename(this.abs(from), this.abs(to))
  }
  trash = (file: string) => this.move(file, `trash/${file}`)
  restore = (file: string) => this.move(`trash/${file}`, file)
  async trashed() {
    const out: Page[] = []
    for (const dir of this.dirs()) for (const n of await fs.readdir(this.abs(`trash/${dir}`)).catch(() => [] as string[]))
      try { out.push(parsePage(await fs.readFile(this.abs(`trash/${dir}/${n}`), 'utf8'), `${dir}/${n}`)) } catch { /* skip */ }
    return out
  }
  emptyTrash = () => fs.rm(this.abs('trash'), { recursive: true, force: true })

  async readYaml(file: string) { try { return parse(await fs.readFile(this.abs(file), 'utf8')) } catch { return null } }
  writeYaml = (file: string, obj: object) => this.writeText(file, writeYaml(obj))

  /** Reports page files changed by anything other than this app: git, an external editor, another tool. */
  watch(onChange: (file: string, page: Page | null) => void) {
    this.watcher = watch(this.root, { recursive: true }, (_e, f) => {
      const file = f?.toString().replace(/\\/g, '/')
      if (!file?.endsWith('.md') || !this.dirs().includes(file.split('/')[0]) || file.split('/').length !== 2) return
      clearTimeout(this.pending.get(file))
      this.pending.set(file, setTimeout(async () => {
        const text = await fs.readFile(this.abs(file), 'utf8').catch(() => null)
        if (text === null) { if (this.own.get(file) !== 'gone') onChange(file, null); return }
        if (this.own.get(file) === hash(text)) return
        this.own.set(file, hash(text))
        try { onChange(file, parsePage(text, file)) } catch { /* half-written file; the next event will read it */ }
      }, 120))
    })
  }
  close() { this.watcher?.close() }
  abs = (file: string) => path.join(this.root, file)
}
