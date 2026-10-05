# QuestNotes

Quest design for Broken Wings, in lore terms. A desktop app for quest designers: a master map of every quest by Act and
questline, a page per quest, character, faction, district, threshold, leak channel and mystery, tables for thresholds and
cast, and a light link to Animus. Quests are ported into Animus by hand; QuestNotes never writes to the game repo.

## Use

- **Map.** Acts and their sub-sections are columns, questlines are rows; a card's cell is its Act and questline. Drag a
  card to move it, drag from its right edge to another card to add *Leads to* or a *Pays off* link from a branching row,
  drop on empty canvas to create a connected quest, double-click empty canvas to add one. Quests with no Act wait in the
  Hooks tray. Zooming out shrinks cards to their IDs. Click any chip to filter; nothing moves when you filter.
- **Pages** open beside the map (Space) or full (Enter). Fields use the Quest Index's own terms. In the text, `@` or `[[`
  links a page and `/` inserts a heading, list or table. Everything saves as you go; deleted pages go to the Trash.
- **Threshold ledger, Cast matrix, Handoff, Issues** are in the sidebar. `Ctrl K` finds any page or command; `?` lists
  the shortcuts.
- **Animus.** In Settings choose the game folder: QuestNotes reads `resources/quests` and shows on every quest whether it
  exists in Animus. A quest marked *Ready for engine* with no Animus quest gets an amber flag and appears under Handoff
  with a brief for the engine designer. *Open in Animus* needs the QuestNotes Bridge addon (below).
- **Sync** shares the lore folder through git: one button commits, fetches, merges and pushes. Edits to different lines
  merge on their own; edits to the same line come back to choose.

The first time, create a project and import the design documents (`.docx`): the Quest Index, the Narrative, the
character documents and the world document. The import lists what it could not decide (name clashes, districts one
document lacks) under Issues.

## The lore folder

One Markdown file per page with a YAML header, in its own git repository, separate from the game:

```
questnotes.yaml        project name
quests/ questlines/ acts/ characters/ factions/ districts/ thresholds/ leaks/ mysteries/
views/map.yaml         order of cards inside each map cell
views/issues.yaml      import issues not yet settled
engine/animus-index.yaml   last scan of Animus, for writers without the game repo
trash/
```

Only QuestNotes writes the YAML headers, so they stay canonical and diff cleanly. Links are `[[page_id]]`.

## Open in Animus

Copy `bridge/addons/questnotes_bridge` into the game project's `addons/` and enable *QuestNotes Bridge* under
Project Settings › Plugins. It listens on 127.0.0.1 only, requires the token it writes to the ignored
`.godot/questnotes_bridge.json`, and opens a quest through Animus's own file handler. It changes nothing in Animus.
When Godot is closed, QuestNotes starts it (`godot -e --path <game> ++ --questnotes-open=<quest>#<stage>`); set the Godot
executable in Settings if it is not on `PATH`.

## Develop

```bash
npm install
npm run dev          # the app with hot reload
npm run typecheck
npm test             # unit tests; the bridge test runs when Godot 4.7 is on PATH or in $GODOT
npm run test:e2e     # builds, then drives the app headless; QUESTNOTES_SHOTS=<dir> keeps screenshots
npm run dist         # installers in release/ (AppImage, NSIS or DMG for the current OS)
```

Tests import the real design documents when `$QUESTNOTES_DOCS` (default `../brokenwings/design_docs`) exists, and small
synthetic ones otherwise. Set `QUESTNOTES_UPDATE_URL` when running `npm run dist` to enable auto-update from a folder of
published builds. CI (`.github/workflows/ci.yml`) runs every test with headless Godot, and builds installers for all
three systems on `v*` tags; a Mac build needs signing to open without warnings and to auto-update.

Electron 44, React 19, React Flow 12, TipTap 3, MiniSearch, dugite. Source: `src/main` (files, git, Animus scan and
bridge client, .docx import), `src/preload`, `src/renderer` (the UI), `src/shared` (page format, schema, merge, engine
states).
