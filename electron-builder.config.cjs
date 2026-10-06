// Installers for Linux, Windows and macOS. Auto-update is on when QUESTNOTES_UPDATE_URL names a folder of published builds.
const url = process.env.QUESTNOTES_UPDATE_URL

module.exports = {
  appId: 'org.questnotes.app',
  productName: 'QuestNotes',
  directories: { output: 'release' },
  files: ['out/**'],
  asarUnpack: ['node_modules/dugite/git/**'],
  // elkjs (EPL-2.0) is bundled into the window's code unmodified; its licence travels with the app.
  extraResources: [{ from: 'bridge', to: 'bridge' }, { from: 'node_modules/elkjs/LICENSE.md', to: 'licenses/elkjs-LICENSE.md' }],
  linux: { target: 'AppImage', category: 'Office', syncDesktopName: true },
  win: { target: 'nsis' },
  mac: { target: 'dmg' },
  publish: url ? { provider: 'generic', url } : null,
}
