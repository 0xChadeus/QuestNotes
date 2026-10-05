# QuestNotes

A desktop app for designing branching quests in story terms. Quest designers work with quests, characters, factions,
districts, acts, thresholds, leak channels and mysteries, not with engine data. A master map shows every quest by act and
questline, each card opens a detailed page, and tables cover thresholds and the cast. A light link to the game's quest
system shows which quests exist in the engine and opens them there. Quests are ported into the engine by hand;
QuestNotes never writes to the game project.

## Use

- **Map.** Acts and their sub-sections are columns, questlines are rows; a card's cell is its act and questline. Drag a
  card to move it, drag from its right edge to another card to add *Leads to* or a *Pays off* link from a branching row,
  drop on empty canvas to create a connected quest, double-click empty canvas to add one. Quests with no act wait in the
  Hooks tray. Zooming out shrinks cards to their IDs. Click any chip to filter; nothing moves when you filter.
- **Pages** open beside the map (Space) or full (Enter). In the text, `@` or `[[` links a page and `/` inserts a
  heading, list or table. Everything saves as you go; deleted pages go to the Trash.
- **Threshold ledger, Cast matrix, Handoff, Issues** are in the sidebar. `Ctrl K` finds any page or command; `?` lists
  the shortcuts.
- **Engine link.** In Settings choose the game folder: QuestNotes reads the quest files under `resources/quests` and
  shows on every quest whether it exists in the engine. A quest marked *Ready for engine* with no engine quest gets an
  amber flag and appears under Handoff with a brief for whoever builds it. Opening a quest in the engine needs the
  bridge addon (below).
- **Sync** shares the lore folder through git: one button commits, fetches, merges and pushes. Edits to different lines
  merge on their own; edits to the same line come back to choose.

A new project can start from existing design documents (`.docx`): quest entries, character profiles, the world's
districts, factions and mysteries, and the act structure. The import lists what it could not decide, such as name clashes
or places one document lacks, under Issues.

## The lore folder

One Markdown file per page with a YAML header, in its own git repository, separate from the game:

```
questnotes.yaml        project name
quests/ questlines/ acts/ characters/ factions/ districts/ thresholds/ leaks/ mysteries/
views/map.yaml         order of cards inside each map cell
views/issues.yaml      import issues not yet settled
engine/animus-index.yaml   last scan of the engine, for writers without the game project
trash/
```

Only QuestNotes writes the YAML headers, so they stay canonical and diff cleanly. Links are `[[page_id]]`.

## Opening quests in the engine

The engine side is a Godot editor plugin that edits quest JSON files. Copy `bridge/addons/questnotes_bridge` into the
game project's `addons/` and enable *QuestNotes Bridge* under Project Settings › Plugins. It listens on 127.0.0.1 only,
requires the token it writes to the ignored `.godot/questnotes_bridge.json`, and hands the quest to the editor's own
file handler. It changes nothing else in the project. When Godot is closed, QuestNotes starts it
(`godot -e --path <game> ++ --questnotes-open=<quest>#<stage>`); set the Godot executable in Settings if it is not on
`PATH`.

## Develop

```bash
npm install
npm run dev          # the app with hot reload
npm run typecheck
npm test             # unit tests; the bridge test runs when Godot 4.7 is on PATH or in $GODOT
npm run test:e2e     # builds, then drives the app headless; QUESTNOTES_SHOTS=<dir> keeps screenshots
npm run dist         # installers in release/ (AppImage, NSIS or DMG for the current OS)
```

Tests use small synthetic design documents, or the documents in `$QUESTNOTES_DOCS` when it is set. Set
`QUESTNOTES_UPDATE_URL` when running `npm run dist` to enable auto-update from a folder of published builds. CI
(`.github/workflows/ci.yml`) runs every test with headless Godot, and builds installers for all three systems on `v*`
tags; a Mac build needs signing to open without warnings and to auto-update.

Electron 44, React 19, React Flow 12, TipTap 3, MiniSearch, dugite. Source: `src/main` (files, git, engine scan and
bridge client, .docx import), `src/preload`, `src/renderer` (the UI), `src/shared` (page format, schema, merge, engine
states).
