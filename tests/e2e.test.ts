// Drives the built app (npm run test:e2e) headless against a lore folder imported from the fixture documents.
// Set QUESTNOTES_SHOTS=<dir> to keep screenshots.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page as Window } from 'playwright'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { importDocs } from '../src/main/importer'
import { writePage } from '../src/shared/page'
import * as git from '../src/main/git'
import { docs } from './fixtures'

const run = process.env.npm_lifecycle_event === 'test:e2e'
const shots = process.env.QUESTNOTES_SHOTS

describe.skipIf(!run)('QuestNotes app', () => {
  const lore = mkdtempSync(path.join(tmpdir(), 'qn-lore-'))
  const game = path.join(__dirname, 'bridge/project')
  let app: ElectronApplication, page: Window
  const file = (id: string) => readFileSync(path.join(lore, `quests/${id}.md`), 'utf8')
  const shot = (n: string) => shots ? page.screenshot({ path: path.join(shots, `${n}.png`) }) : undefined
  const center = async (sel: ReturnType<Window['locator']>) => { const b = (await sel.boundingBox())!; return { x: b.x + b.width / 2, y: b.y + b.height / 2 } }
  const saved = (id: string, what: string | RegExp) => expect.poll(() => file(id), { timeout: 5000 })[typeof what === 'string' ? 'toContain' : 'toMatch'](what as never)

  beforeAll(async () => {
    for (const p of importDocs(docs(), []).pages) { mkdirSync(path.dirname(path.join(lore, p.file)), { recursive: true }); writeFileSync(path.join(lore, p.file), writePage(p.data, p.body)) }
    writeFileSync(path.join(lore, 'questnotes.yaml'), 'name: Broken Wings\nversion: 1\n')
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
  afterAll(() => app?.close())

  it('opens the recent project on the map', async () => {
    await page.getByRole('button', { name: lore }).click()
    await page.locator('.card', { hasText: 'MQ02' }).waitFor()
    await page.waitForTimeout(500); await shot('1-map')
  })
  it('opens a card beside the map and saves edits to the page file', async () => {
    await page.locator('.card', { hasText: 'MQ02' }).click(); await page.keyboard.press('Space')
    const title = page.locator('.peek .title')
    await title.fill('Night Life, revised')
    await saved('q_mq02', 'title: Night Life, revised')
    await title.fill('Night Life')
    await page.locator('.peek .tiptap p').first().click(); await page.keyboard.press('Control+End'); await page.keyboard.type(' Added line.')
    await saved('q_mq02', 'Added line.')
    await shot('2-peek')
  })
  it('flags a Ready quest that is not in Animus', async () => {
    await page.locator('.peek .seg button', { hasText: 'Ready for engine' }).click()
    await page.locator('.peek .animus .badge', { hasText: 'Needs creating in Animus' }).waitFor()
    await page.locator('.card.needs', { hasText: 'MQ02' }).waitFor(); await shot('3-ready')
    await saved('q_mq02', /handoff_on: \d{4}-\d\d-\d\d/)
  })
  it('renders the ledger, cast matrix, handoff and issues', async () => {
    await page.keyboard.press('Escape')
    for (const [view, sel] of [['Threshold ledger', '.ledger'], ['Cast matrix', '.cast'], ['Handoff', '.grid'], ['Issues', '.toolbar']]) {
      await page.locator('.sidebar button', { hasText: view }).click(); await page.locator(sel).first().waitFor(); await shot(view)
    }
    await page.locator('.sidebar button', { hasText: 'Handoff' }).click()
    await page.getByRole('button', { name: 'Brief' }).first().click(); await page.locator('.brief').waitFor(); await shot('brief')
    expect(await page.locator('.brief').textContent()).toContain('res://resources/quests/main/mq02.json')
  })
  it('finds pages from the palette', async () => {
    await page.keyboard.press('Escape'); await page.keyboard.press('Control+k'); await page.keyboard.type('Lyra Frost'); await page.keyboard.press('Enter')
    await page.locator('.content h4', { hasText: 'In quests' }).waitFor(); await shot('character')
  })
  it('moves a card to another Act, with undo', async () => {
    await page.locator('.sidebar button', { hasText: 'Map' }).click(); await page.locator('.card').first().waitFor()
    const from = await center(page.locator('.card', { hasText: 'MQ02' }))
    const to = await center(page.locator('.col-heads > div', { hasText: /Act II ·/i }))
    await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, from.y, { steps: 12 }); await page.mouse.up()
    await saved('q_mq02', /^act: act_2$/m)
    await page.getByRole('button', { name: 'Undo' }).click()
    await saved('q_mq02', /^act: act_1$/m)
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
    await page.mouse.move(900, 500); for (let i = 0; i < 5; i++) await page.mouse.wheel(0, 300)
    await page.locator('.card.z-far').first().waitFor(); await shot('far')
  })
  it('places a hook dragged from the tray', async () => {
    await page.keyboard.press('z'); await page.waitForTimeout(500)
    const hook = page.locator('.tray .hook').first(), name = (await hook.textContent())!
    await hook.dragTo(page.locator('.react-flow__pane'), { targetPosition: { x: 1150, y: 120 } })
    await page.locator('.card', { hasText: name.slice(0, 20) }).waitFor(); await shot('hook-placed')
  })
  it('wrote the Animus snapshot to the lore folder, never to the game', () => {
    expect(readFileSync(path.join(lore, 'engine/animus-index.yaml'), 'utf8')).toContain('mq01')
  })
})
