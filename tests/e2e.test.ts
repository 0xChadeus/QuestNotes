// Drives the built app (npm run test:e2e) headless against a lore folder imported from the fixture documents.
// Set QUESTNOTES_SHOTS=<dir> to keep screenshots.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page as Window } from 'playwright'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { importDocs } from '../src/main/importer'
import { writePage } from '../src/shared/page'
import * as git from '../src/main/git'
import { resolveSchema } from '../src/shared/schema'
import { parse } from 'yaml'
import { JOBS, docx, h, p as para, synthetic } from './fixtures'

const run = process.env.npm_lifecycle_event === 'test:e2e'
const shots = process.env.QUESTNOTES_SHOTS

describe.skipIf(!run)('QuestNotes app', () => {
  const lore = mkdtempSync(path.join(tmpdir(), 'qn-lore-'))
  const game = path.join(__dirname, 'bridge/project')
  let app: ElectronApplication, page: Window
  const file = (id: string) => readFileSync(path.join(lore, `quests/${id}.md`), 'utf8')
  const shot = (n: string) => shots ? page.screenshot({ path: path.join(shots, `${n}.png`) }) : undefined
  const center = async (sel: ReturnType<Window['locator']>) => { const b = (await sel.boundingBox())!; return { x: b.x + b.width / 2, y: b.y + b.height / 2 } }
  const pos = (id: string) => (parse(readFileSync(path.join(lore, 'views/map.yaml'), 'utf8')).nodes as { id: string; x: number; y: number }[]).find((n) => n.id === id)
  const frames = () => (parse(readFileSync(path.join(lore, 'views/map.yaml'), 'utf8')).frames ?? []) as { id: string; label: string; x: number; y: number }[]
  const drag = async (sel: ReturnType<Window['locator']>, dx: number, dy: number) => {
    const a = await center(sel)
    await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(a.x + dx, a.y + dy, { steps: 12 }); await page.mouse.up()
  }
  const saved = (id: string, what: string | RegExp) => expect.poll(() => file(id), { timeout: 5000 })[typeof what === 'string' ? 'toContain' : 'toMatch'](what as never)

  beforeAll(async () => {
    for (const p of importDocs(synthetic, JOBS, resolveSchema(), []).pages) { mkdirSync(path.dirname(path.join(lore, p.file)), { recursive: true }); writeFileSync(path.join(lore, p.file), writePage(p.data, p.body)) }
    writeFileSync(path.join(lore, 'quests/q_untitled.md'), '---\nid: q_untitled\ntype: quest\nstatus: idea\n---\n')
    writeFileSync(path.join(lore, 'questnotes.yaml'), 'name: Harbor Tales\nengine: {preset: animus}\nmatrix: {kind: faction, field: factions, title: Faction ledger}\n')
    Object.assign(process.env, { GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com' })
    await git.init(lore)
    const config = mkdtempSync(path.join(tmpdir(), 'qn-config-'))
    mkdirSync(path.join(config, 'QuestNotes'))
    writeFileSync(path.join(config, 'QuestNotes/settings.json'), JSON.stringify({ recent: [lore], games: { [lore]: game } }))
    if (shots) mkdirSync(shots, { recursive: true })
    app = await electron.launch({ args: ['.', '--ozone-platform=headless'], env: { ...process.env, XDG_CONFIG_HOME: config } })
    page = await app.firstWindow()
    page.on('pageerror', (e) => { throw e })
    await page.setViewportSize({ width: 1600, height: 960 })
  }, 60000)
  afterAll(() => app?.close().catch(() => {}))

  it('reopens the last project on the map at launch, laid out once from the grid', async () => {
    await page.locator('.card', { hasText: 'MQ02' }).waitFor()
    await page.waitForTimeout(500); await shot('1-map')
    expect(pos('q_mq02')!.x).toBeLessThan(pos('q_mq03')!.x)
    expect(frames().map((f) => f.label)).toEqual(['Act I · Calm Waters'])
  })
  it('opens a card beside the map and saves edits to the page file', async () => {
    await page.locator('.card', { hasText: 'MQ02' }).locator('.card-head').click(); await page.keyboard.press('Space')
    const title = page.locator('.peek .title')
    await title.fill('Night Tide, revised')
    await saved('q_mq02', 'title: Night Tide, revised')
    await title.fill('Night Tide')
    await page.locator('.peek .tiptap p').first().click(); await page.keyboard.press('Control+End'); await page.keyboard.type(' Added line.')
    await saved('q_mq02', 'Added line.')
    await shot('2-peek')
  })
  it('flags a Ready quest that is not in the engine', async () => {
    await page.locator('.peek .seg button', { hasText: 'Ready for engine' }).click()
    await page.locator('.peek .engine-box .badge', { hasText: 'Needs creating in Animus' }).waitFor()
    await page.locator('.card.needs', { hasText: 'MQ02' }).waitFor(); await shot('3-ready')
    await saved('q_mq02', /handoff_on: \d{4}-\d\d-\d\d/)
  })
  it('renders the configured matrix, the cast, handoff and issues', async () => {
    await page.keyboard.press('Escape')
    for (const [view, sel] of [['Faction ledger', '.matrix'], ['Cast', '.cast'], ['Handoff', '.grid'], ['Issues', '.toolbar']]) {
      await page.locator('.sidebar button', { hasText: view }).click(); await page.locator(sel).first().waitFor(); await shot(view)
    }
    await page.locator('.sidebar button', { hasText: 'Handoff' }).click()
    await page.getByRole('button', { name: 'Brief' }).first().click(); await page.locator('.brief').waitFor(); await shot('brief')
    expect(await page.locator('.brief').textContent()).toContain('res://resources/quests/main/mq02.json')
  })
  it('finds pages from the palette', async () => {
    await page.keyboard.press('Escape'); await page.keyboard.press('Control+k'); await page.keyboard.type('Mara Quill'); await page.keyboard.press('Enter')
    await page.locator('.content h4', { hasText: 'In quests' }).waitFor(); await shot('character')
  })
  it('moves a card anywhere without touching its act, with undo', async () => {
    await page.locator('.sidebar button', { hasText: 'Map' }).click(); await page.locator('.card').first().waitFor(); await page.waitForTimeout(500)
    const was = pos('q_mq02')!
    await drag(page.locator('.card', { hasText: 'MQ02' }).locator('.card-head'), 260, 330)
    await expect.poll(() => pos('q_mq02')!.y).toBeGreaterThan(was.y + 100)
    expect(file('q_mq02')).toMatch(/^act: act_1$/m)
    await page.keyboard.press('Control+z')
    await expect.poll(() => pos('q_mq02')).toEqual(was)
  })
  it('connects two cards with a Leads to link', async () => {
    const src = await center(page.locator('.react-flow__node', { hasText: 'MQ02' }).locator('.react-flow__handle-right'))
    const dst = await center(page.locator('.react-flow__node', { hasText: 'MQ03' }).locator('.react-flow__handle-left'))
    await page.mouse.move(src.x, src.y); await page.mouse.down(); await page.mouse.move(dst.x, dst.y, { steps: 15 }); await page.mouse.up()
    await page.locator('.menu button', { hasText: 'Leads to' }).click()
    await saved('q_mq02', 'leads_to:\n  - {ref: q_mq03}')
    await page.locator('.react-flow__edge.leads').first().waitFor({ state: 'attached' }); await shot('connected')
  })
  it('shows ID tiles when zoomed far out', async () => {
    await page.mouse.move(900, 500); await page.keyboard.down('Control'); for (let i = 0; i < 5; i++) await page.mouse.wheel(0, 300); await page.keyboard.up('Control')
    await page.locator('.card.z-far').first().waitFor(); await shot('far')
  })
  it('places a hook dragged from the tray', async () => {
    await page.keyboard.press('z'); await page.waitForTimeout(500)
    const hook = page.locator('.tray .hook').first(), name = (await hook.textContent())!
    await hook.dragTo(page.locator('.react-flow__pane'), { targetPosition: { x: 1150, y: 120 } })
    await page.locator('.card', { hasText: name.slice(0, 20) }).waitFor(); await shot('hook-placed')
  })
  it('undoes and redoes with Ctrl+Z and Ctrl+Shift+Z', async () => {
    await page.locator('.card', { hasText: 'MQ03' }).locator('.card-head').click()
    await page.keyboard.press('2')
    await saved('q_mq03', 'status: outline')
    await page.keyboard.press('Control+z')
    await saved('q_mq03', 'status: draft')
    await page.keyboard.press('Control+Shift+z')
    await saved('q_mq03', 'status: outline')
  })
  it('throws away a blank quest closed untouched, and undoes a named one', async () => {
    const count = () => readdirSync(path.join(lore, 'quests')).length
    const before = count()
    await page.keyboard.press('n'); await page.locator('.peek .title').waitFor()
    await expect.poll(count).toBe(before + 1)
    await page.keyboard.press('Escape')
    await expect.poll(count).toBe(before)
    await page.keyboard.press('n'); await page.locator('.peek .title').fill('Scratch')
    await expect.poll(count).toBe(before + 1)
    await page.keyboard.press('Escape'); await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z')
    await expect.poll(count).toBe(before)
  })
  it('deletes a page from its list and brings it back with Ctrl+Z', async () => {
    const live = path.join(lore, 'secrets/se_who_sank_the_meridian.md')
    await page.locator('.sidebar button', { hasText: 'Secrets' }).click()
    const row = page.locator('.grid.list tbody tr', { hasText: 'Who Sank the Meridian?' })
    await row.hover(); await row.getByRole('button', { name: 'Delete' }).click()
    await expect.poll(() => existsSync(live)).toBe(false)
    expect(existsSync(path.join(lore, 'trash/secrets/se_who_sank_the_meridian.md'))).toBe(true)
    await page.keyboard.press('Control+z')
    await expect.poll(() => existsSync(live)).toBe(true)
    await row.waitFor(); await shot('list')
  })
  it('goes back and forward with Alt+arrows', async () => {
    await page.keyboard.press('Alt+ArrowLeft')
    await page.locator('.card').first().waitFor()
    await page.keyboard.press('Alt+ArrowRight')
    await page.locator('.grid.list').waitFor()
    await page.locator('.sidebar button', { hasText: 'Map' }).click(); await page.waitForTimeout(500)
  })
  it('removes a link from its context menu', async () => {
    await page.locator('.react-flow__edge.leads').first().click({ button: 'right', force: true })
    await shot('link-menu')
    await page.locator('.menu.ctx button', { hasText: 'Remove this link' }).click()
    await saved('q_mq02', /^(?![\s\S]*leads_to)/)
  })
  it('duplicates a quest from its card menu, then edits its branch table', async () => {
    await page.locator('.card', { hasText: 'MQ02' }).locator('.card-head').click({ button: 'right' })
    await shot('card-menu')
    await page.locator('.menu.ctx button', { hasText: 'Duplicate' }).click()
    await expect.poll(() => page.locator('.peek .title').inputValue()).toBe('Night Tide (copy)')
    await saved('q_night_tide_copy', 'title: Night Tide (copy)')
    await page.locator('.peek .tiptap td', { hasText: 'Player tells the Guild' }).click()
    await page.locator('.peek .table-tools button', { hasText: '+ Row below' }).click()
    await saved('q_night_tide_copy', '|  |  |  |')
    await page.locator('.peek .table-tools button', { hasText: '− Row' }).click()
    await saved('q_night_tide_copy', /^(?![\s\S]*Player tells the Guild)/); await shot('table-tools')
  })
  it('frames the selection with Ctrl+G, and the frame carries its cards when dragged', async () => {
    await page.keyboard.press('Escape')
    await page.locator('.card', { hasText: 'MQ02' }).locator('.card-head').click()
    await page.locator('.card', { hasText: 'MQ03' }).locator('.card-head').click({ modifiers: ['Control'] })
    await page.keyboard.press('Control+g')
    await page.locator('input.ask').fill('Harbour run'); await page.keyboard.press('Enter')
    await expect.poll(() => frames().map((f) => f.label)).toContain('Harbour run')
    const [f0, a0, b0] = [frames().find((f) => f.label === 'Harbour run')!, pos('q_mq02')!, pos('q_mq03')!]
    await drag(page.locator('.frame-label', { hasText: 'Harbour run' }), 200, 160)
    await expect.poll(() => frames().find((f) => f.label === 'Harbour run')!.y).toBeGreaterThan(f0.y + 40)
    const f1 = frames().find((f) => f.label === 'Harbour run')!, [dx, dy] = [f1.x - f0.x, f1.y - f0.y]
    expect(pos('q_mq02')).toEqual({ id: 'q_mq02', x: a0.x + dx, y: a0.y + dy })
    expect(pos('q_mq03')).toEqual({ id: 'q_mq03', x: b0.x + dx, y: b0.y + dy }); await shot('frame')
    await page.keyboard.press('Control+z')
    await expect.poll(() => pos('q_mq02')).toEqual(a0)
  })
  it('nudges with the arrow keys, one undo step for a burst', async () => {
    await page.locator('.card', { hasText: 'MQ03' }).locator('.card-head').click()
    const was = pos('q_mq03')!
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Shift+ArrowDown')
    await expect.poll(() => pos('q_mq03')).toEqual({ id: 'q_mq03', x: was.x + 15, y: was.y + 20 })
    await page.keyboard.press('Control+z')
    await expect.poll(() => pos('q_mq03')).toEqual(was)
  })
  it('box-selects cards by dragging on empty canvas', async () => {
    await page.keyboard.press('Escape')
    const [a, b] = [await page.locator('.react-flow__node', { hasText: 'MQ02' }).boundingBox(), await page.locator('.react-flow__node', { hasText: 'MQ03' }).boundingBox()]
    const [x0, y0, x1, y1] = [Math.min(a!.x, b!.x) - 30, Math.min(a!.y, b!.y) - 30, Math.max(a!.x + a!.width, b!.x + b!.width) + 30, Math.max(a!.y + a!.height, b!.y + b!.height) + 30]
    await page.mouse.move(x0, y0); await page.mouse.down(); await page.mouse.move(x1, y1, { steps: 10 }); await page.mouse.up()
    await expect.poll(() => page.locator('.card.sel').count()).toBeGreaterThanOrEqual(2); await shot('box-select')
    await page.keyboard.press('Escape')
  })
  it('tidies a selection and places every hook', async () => {
    await page.locator('.card', { hasText: 'MQ02' }).locator('.card-head').click()
    await page.locator('.card', { hasText: 'MQ03' }).locator('.card-head').click({ modifiers: ['Control'] })
    const before = [pos('q_mq02'), pos('q_mq03')]
    await page.getByRole('button', { name: 'Tidy' }).click()
    await expect.poll(() => [pos('q_mq02'), pos('q_mq03')]).not.toEqual(before)
    await page.getByRole('button', { name: 'Place all' }).click()
    await expect.poll(() => page.locator('.tray .hook').count()).toBe(0)
    expect(pos('q_untitled')).toBeDefined(); await shot('placed-all')
  })
  it('acts on the selection only while it is on screen', async () => {
    await page.locator('.card', { hasText: 'MQ03' }).locator('.card-head').click()
    await page.locator('.sidebar button', { hasText: 'Cast' }).click(); await page.locator('.cast').waitFor()
    await page.keyboard.press('Delete'); await page.waitForTimeout(400)
    expect(existsSync(path.join(lore, 'quests/q_mq03.md'))).toBe(true)
    await page.locator('.sidebar button', { hasText: 'Map' }).click(); await page.waitForTimeout(500)
  })
  it('picks several cards with Ctrl-click and sets their status in one step', async () => {
    await page.locator('.card', { hasText: 'MQ02' }).locator('.card-head').click()
    await page.locator('.card', { hasText: 'MQ03' }).locator('.card-head').click({ modifiers: ['Control'] })
    await page.keyboard.press('4')
    await saved('q_mq02', 'status: review'); await saved('q_mq03', 'status: review')
    await page.keyboard.press('Control+z')
    await saved('q_mq02', 'status: ready'); await saved('q_mq03', 'status: outline')
    await page.keyboard.press('Escape')
  })
  it('closes only the picker on Escape, not the side panel', async () => {
    await page.locator('.card', { hasText: 'MQ03' }).locator('.card-head').click(); await page.keyboard.press('Space')
    await page.locator('.peek .field', { hasText: 'Involved' }).getByRole('button', { name: '+ Add' }).click()
    await page.locator('.peek .picker input').waitFor()
    await page.keyboard.press('Escape')
    await expect.poll(() => page.locator('.peek .picker').count()).toBe(0)
    expect(await page.locator('.peek').count()).toBe(1)
  })
  it('shows a change made on disk in the open page', async () => {
    const f = path.join(lore, 'quests/q_mq03.md')
    writeFileSync(f, readFileSync(f, 'utf8').replace('Into the dark.', 'Into the deep dark.'))
    await page.locator('.peek .tiptap', { hasText: 'Into the deep dark.' }).waitFor()
    await page.keyboard.press('Escape')
  })
  it('lists matching commands before pages in the palette', async () => {
    await page.keyboard.press('Control+k'); await page.keyboard.type('settings')
    expect(await page.locator('.palette li').first().textContent()).toMatch(/^Settings/)
    await page.keyboard.press('Escape')
  })
  it('imports a document through a suggested job and remembers the job', async () => {
    const doc = docx('More_quests.docx', h(1, 'MQ09 — LOW WATER') + para('Quest giver: Mara Quill') + h(2, 'Description') + para('The harbour drains.'))
    const docPath = path.join(mkdtempSync(path.join(tmpdir(), 'qn-docs-')), doc.name)
    writeFileSync(docPath, doc.data)
    await app.evaluate(({ dialog }, f) => { dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [f] })) as never }, docPath)
    await page.locator('.sidebar button', { hasText: 'Settings' }).click()
    await page.getByRole('button', { name: 'Import design documents…' }).click()
    await page.getByRole('button', { name: 'Choose .docx files…' }).click()
    expect(await page.locator('.modal textarea.yaml').inputValue()).toContain('kind: quest')
    await page.locator('.modal pre.outline', { hasText: 'H1 MQ09 — LOW WATER' }).waitFor({ state: 'attached' }); await shot('import-jobs')
    await page.getByRole('button', { name: 'Preview' }).click()
    await page.getByRole('button', { name: 'Import 1 page' }).click()
    await page.locator('.tray .hook', { hasText: 'MQ09' }).waitFor()
    expect(file('q_mq09')).toContain('- {ref: ch_mara_quill}')
    expect(readFileSync(path.join(lore, 'questnotes.yaml'), 'utf8')).toMatch(/import:\n  - \{file: More_quests\\\.docx, kind: quest/)
  })
  it('edits questnotes.yaml from the project settings', async () => {
    await page.locator('.sidebar button', { hasText: 'Settings' }).click()
    await page.getByRole('button', { name: 'Project settings' }).click()
    const yaml = page.locator('.modal textarea.yaml')
    expect(await yaml.inputValue()).toContain('preset: animus')
    await yaml.fill((await yaml.inputValue()).replace('Harbor Tales', 'Harbour Tales')); await shot('project-settings')
    await page.getByRole('button', { name: 'Save and reload' }).click()
    await page.locator('.sidebar .project', { hasText: 'Harbour Tales' }).waitFor()
    expect(readFileSync(path.join(lore, 'questnotes.yaml'), 'utf8')).toContain('name: Harbour Tales')
  })
  it('wrote the engine snapshot to the lore folder, never to the game', () => {
    expect(readFileSync(path.join(lore, 'engine/index.yaml'), 'utf8')).toContain('mq01')
  })
  it('creates a new project and opens an existing one from the Welcome screen', async () => {
    const fresh = mkdtempSync(path.join(tmpdir(), 'qn-new-'))
    const answer = (dir: string) => app.evaluate(({ dialog }, d) => { dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [d] })) as never }, dir)
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape')
    await page.locator('.sidebar button.project').click(); await page.locator('.menu.ctx button', { hasText: 'Switch project' }).click()
    await page.locator('.welcome input').fill('Second Story'); await answer(fresh)
    await page.getByRole('button', { name: 'Create…' }).click()
    await page.locator('.sidebar .project', { hasText: 'Second Story' }).waitFor()
    await page.keyboard.press('Escape')
    await page.locator('.map-hint', { hasText: 'Double-click anywhere to add a quest' }).waitFor()
    expect(readFileSync(path.join(fresh, 'questnotes.yaml'), 'utf8')).toContain('name: Second Story')
    await page.locator('.sidebar button.project').click(); await page.locator('.menu.ctx button', { hasText: 'Switch project' }).click()
    await answer(lore); await page.getByRole('button', { name: 'Open…' }).click()
    await page.locator('.card', { hasText: 'MQ03' }).waitFor(); await shot('reopened')
  })
  it('writes what was just typed when the window closes', async () => {
    await page.locator('.card', { hasText: 'MQ03' }).locator('.card-head').click(); await page.keyboard.press('Space')
    await page.locator('.peek .synopsis').fill('Typed a moment before closing')
    await app.close()
    expect(file('q_mq03')).toContain('synopsis: Typed a moment before closing')
  })
})
