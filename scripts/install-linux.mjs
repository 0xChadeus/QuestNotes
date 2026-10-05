// Installs the Linux build for the current user: the app in ~/.local/opt/questnotes and a menu entry for the desktop.
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import path from 'node:path'

const build = 'release/linux-unpacked'
if (!existsSync(build)) throw new Error(`${build} is missing; run npm run dist first`)
const dest = path.join(homedir(), '.local/opt/questnotes')
const apps = path.join(homedir(), '.local/share/applications')
rmSync(dest, { recursive: true, force: true })
cpSync(build, dest, { recursive: true })
cpSync('build/icon.png', path.join(dest, 'questnotes.png'))
mkdirSync(apps, { recursive: true })
writeFileSync(path.join(apps, 'questnotes.desktop'), `[Desktop Entry]
Name=QuestNotes
Comment=Design branching quests in story terms
Exec=${dest}/questnotes %U
Icon=${dest}/questnotes.png
Terminal=false
Type=Application
Categories=Office;
StartupWMClass=questnotes
`)
for (const [cmd, ...args] of [['update-desktop-database', apps], ['kbuildsycoca6']]) {
  try { execFileSync(cmd, args, { stdio: 'ignore' }) } catch { /* not every desktop has these */ }
}
console.log(`Installed to ${dest}; QuestNotes is in the application menu.`)
