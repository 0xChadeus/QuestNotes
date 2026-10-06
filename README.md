# QuestNotes

A desktop app for designing branching quests in story terms. Quest designers work with quests, the people who give
them, the places and factions they touch and what they reveal, not with engine data. A free-form map shows every quest
where the designer put it, each card opens a detailed page, and tables cover the cast and anything else the project tracks. A
light link to the game's quest system shows which quests exist in the engine and opens them there. Quests are ported
into the engine by hand; QuestNotes never writes to the game project.

## Use

- **Map.** One free canvas: a card stays where you put it, and nothing else moves it. Its act shows as the colour of
  its top edge, its questline as a badge; neither decides where it sits. Drag on empty canvas to select a box of cards
  and drag cards to move them; they snap to a 20 px grid and line up with their neighbours. Drag from a card's right
  edge to another card to add *Leads to* or a *Pays off* link from a branch row, or onto empty canvas to create a
  connected quest; drag a link's end to reconnect it. Double-click empty canvas to add a quest.
- **Areas and notes.** Areas are coloured regions behind the cards. Draw one with *+ Area*, or put selected cards in
  one from their menu. Click an empty spot inside an area to select it (a drag there still draws a selection box); a
  selected area drags from anywhere, with everything inside it, and resizes by its edges. Its name is always a drag
  handle; double-click it to rename. The toolbar over a selected area sets its colour, fits it to its cards or deletes
  it (the cards stay). Notes (*+ Note*) are text on the canvas, resizable and coloured the same way; double-click one to
  edit it. Copying and pasting cards, areas and notes keeps the links between the copied cards. *Tidy* lays out a
  selection left to right (ELK), keeping its rough order; every arrangement is one undo step. Quests not on the map
  wait in the Hooks tray: drag one out, or *Place all*. Zoomed out, cards shrink to their codes. Filters dim cards and
  never move them.
- **Pages** open beside the map or full. In the text you can link other pages and insert headings, lists and tables;
  inside a table, a toolbar adds and deletes rows and columns. Everything saves as you go.
- **Right-click** anything (a card, a link, an area, a note, a list row, a hook) for what you can do to it: open, set
  status, rename, duplicate, align, move, delete. Several cards or rows can be picked to change or delete together.
- **Undo** and redo cover every change: fields, status, moves, links, new and deleted pages. Deleted pages go to the
  Trash, where they can be read, restored or deleted for good.
- **Cast, Handoff, Issues** and the project's own matrix are in the sidebar.
- **Engine link.** When the project names an engine, choose the game folder in Settings: QuestNotes reads the engine's
  quest files and shows on every quest whether it exists there. A quest marked *Ready for engine* with no engine quest
  gets an amber flag and appears under Handoff with a brief for whoever builds it.
- **Sync** shares the lore folder through git: one button commits, fetches, merges and pushes. Edits to different lines
  merge on their own; edits to the same line come back to choose. The map merges card by card and never asks.
- **JSON Canvas.** The map exports to, and imports layouts from, the open JSON Canvas format that Obsidian Canvas uses.

## Projects

`questnotes.yaml` at the root of the lore folder describes the project. Edit it under Settings › Project settings, or
by hand. Everything is optional:

```yaml
name: Harbor Tales
kinds:                       # page kinds besides quests, questlines and acts
  - {id: character, label: Character, prefix: ch, color: "#a0607a"}
  - {id: faction, label: Faction, prefix: fa}
fields:                      # the fields of each kind
  quest:
    - {key: giver, label: Quest giver, kind: rows, to: [character], extras: [note], giver: true, required: true, glyph: G}
    - {key: factions, label: Faction standing, kind: rows, to: [faction], extras: [{key: direction, options: [up, down]}], effect: true}
template: {quest: "## Description\n\n## Branches\n\n| Condition | Outcome | Pays off in |\n| --- | --- | --- |\n|  |  |  |\n"}
required_sections: [Description, Branches]
branches: Branches           # the heading whose table holds branch rows
matrix: {kind: faction, field: factions, title: Faction ledger}
engine: {preset: animus}
import: []                   # import jobs; see below
```

Without `kinds` and `fields` a project gets characters, factions, locations and secrets. Field kinds are `text`,
`long`, `select`, `ref`, `rows`, `tags` and `number`. A `rows` field is a list of page links or free text, each with
the qualifiers named in `extras`. `giver: true` marks the field that says who gives a quest (the cast matrix lists
that kind; Handoff checks it), `effect: true` files a field under Effects and in the brief's "No engine field yet",
`glyph` is the letter the cast matrix shows. `matrix` adds a table of quests against the pages of one kind.

### Engine link

`engine` describes where the game keeps quests. A preset fills it in; any key given next to `preset` overrides it.

```yaml
engine:
  name: Our engine
  quests:
    files: data/quests/**/*.json   # quest files, relative to the game folder
    id: quest_id                   # keys inside each file; dotted paths work
    title: title
    kind: kind
    stages: stages
    stage_id: id
    kinds: [main, side]
    new_path: res://data/quests/{kind}/{id}.json   # shown in the handoff brief
  characters: {files: "npc/**/*.tres", id_pattern: 'character_id\s*=\s*"([^"]+)"'}
  res_prefix: res://               # Godot projects: opens quests in the editor through the bridge
  adapter: ""                      # bridge adapter for engines with their own editor screen
```

The `animus` preset reads Animus quest JSON and opens quests on the Animus screen. Each scan is also written to
`engine/index.yaml` in the lore folder, so writers without the game project still see engine state.

### Import

A project can start from design documents (`.docx`). The import dialog shows each document's headings and a list of
import jobs, prefilled from the project's saved jobs or guessed from file names and quest codes:

```yaml
- {file: World, kind: location, level: 3, under: Places}
- {file: People, kind: character, level: 2, group: {field: home}, hooks: "[QUEST HOOK]"}
- {file: Story, kind: act, pattern: '^Act (?<order>[IVX]+) — (?<title>[^.]+)\.'}
- {file: Quests, kind: quest, level: 1, match: '^[A-Z]+\d+ —', create: [character]}
```

Each heading at `level` (below `under`, matching `match`, not matching `skip`) becomes a page of `kind`. Paragraphs of
the form `Label: value` fill the field with that label (or one of its `aliases`). Names in `rows` values become links;
`create` makes pages for names that have none yet. `group` fills a field from the parent heading, `set` gives fixed
values, `hooks` turns paragraphs with that prefix into Idea quests, and `pattern` makes pages from paragraphs, with
named groups `title`, `order`, `body` or `list`. Whatever the import cannot decide, such as name clashes, goes to
Issues. The jobs are saved in `questnotes.yaml` for the next import.

## The lore folder

One Markdown file per page with a YAML header, in its own git repository, separate from the game:

```
questnotes.yaml        project settings
quests/ questlines/ acts/ and one folder per kind (characters/, factions/, …)
views/map.yaml         where each card, area and note sits (areas as `frames`): one line each, merged by id when syncing
views/issues.yaml      import issues not yet settled
engine/index.yaml      last scan of the engine
trash/
```

Only QuestNotes writes the YAML headers, so they stay canonical and diff cleanly. Links are `[[page_id]]`.

## Opening quests in Godot

For Godot projects, copy `bridge/addons/questnotes_bridge` into the game project's `addons/` and enable *QuestNotes
Bridge* under Project Settings › Plugins. It listens on 127.0.0.1 only, requires the token it writes to the ignored
`.godot/questnotes_bridge.json`, and changes nothing in the project. Without an adapter it opens the quest file in the
inspector; an adapter (`adapters/<name>.gd`, a static `open(path, stage)`) opens it in a quest system's own screen.
`adapters/animus.gd` is the one for Animus. When Godot is closed, QuestNotes starts it
(`godot -e --path <game> ++ --questnotes-open=<quest>#<stage> --questnotes-adapter=<name>`); set the Godot executable
in Settings if it is not on `PATH`.

## Develop

```bash
npm install
npm run dev          # the app with hot reload
npm run typecheck
npm test             # unit tests; the bridge test runs when Godot 4.7 is on PATH or in $GODOT
npm run test:e2e     # builds, then drives the app headless; QUESTNOTES_SHOTS=<dir> keeps screenshots
npm run dist         # installers in release/ (AppImage, NSIS or DMG for the current OS)
npm run install:linux   # builds, installs to ~/.local/opt/questnotes and adds an application-menu entry
```

Tests use small synthetic design documents. Set `QUESTNOTES_DOCS` to a folder of real documents and
`QUESTNOTES_CONFIG` to a `questnotes.yaml` whose import jobs read them, to test against those too. Set
`QUESTNOTES_UPDATE_URL` when running `npm run dist` to enable auto-update from a folder of published builds. CI
(`.github/workflows/ci.yml`) runs every test with headless Godot, and builds installers for all three systems on `v*`
tags; a Mac build needs signing to open without warnings and to auto-update.

Electron 44, React 19, React Flow 12, TipTap 3, MiniSearch, dugite. Source: `src/main` (files, git, engine scan and
bridge client, .docx import), `src/preload`, `src/renderer` (the UI), `src/shared` (page format, schema, merge, engine
states).
