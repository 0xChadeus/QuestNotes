// Per-machine settings, kept out of the lore repo: recent projects, and each project's game folder and Godot path.
import { app } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

interface Settings { recent: string[]; godot?: string; games: Record<string, string>; zoom?: number }
const file = () => path.join(app.getPath('userData'), 'settings.json')

export function load(): Settings {
  try { return { recent: [], games: {}, ...JSON.parse(readFileSync(file(), 'utf8')) } } catch { return { recent: [], games: {} } }
}
export function update(fn: (s: Settings) => void) {
  const s = load()
  fn(s)
  writeFileSync(file(), JSON.stringify(s, null, 1))
  return s
}
export const remember = (root: string) => update((s) => { s.recent = [root, ...s.recent.filter((r) => r !== root)].slice(0, 8) })
