// Installers for Linux, Windows and macOS. Auto-update is on when QUESTNOTES_UPDATE_URL names a folder of published builds.
const url = process.env.QUESTNOTES_UPDATE_URL

module.exports = {
  appId: 'dev.brokenwings.questnotes',
  productName: 'QuestNotes',
  directories: { output: 'release' },
  files: ['out/**'],
  asarUnpack: ['node_modules/dugite/git/**'],
  extraResources: [{ from: 'bridge', to: 'bridge' }],
  linux: { target: 'AppImage', category: 'Office', syncDesktopName: true },
  win: { target: 'nsis' },
  mac: { target: 'dmg' },
  publish: url ? { provider: 'generic', url } : null,
}
