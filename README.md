# Recent Folder Move

An Obsidian plugin that replaces the folder picker of "Move file to…" with one that lists your **most-used folders first** — ranked by how often you move notes there, weighted by how recently.

Obsidian's built-in move dialog always lists folders in the same fixed order, so filing notes into a handful of active folders means typing or scrolling every time. This plugin counts every move into each folder and puts the best-scoring folders at the top.

## Features

- **Frequent first** – with an empty query, the highest-scoring folders appear at the top, marked "frequent" (hover the badge for the move count).
- **Usage-aware search** – when you type, results are ranked by fuzzy match, with higher-scoring folders winning near-ties.
- **Pinned folders** – always listed first. Pin from settings or press `Shift+Alt+Enter` on a folder in the dialog.
- **Excluded folders** – hide folders such as `attachments` (and their subfolders) from the list.
- **Create on the fly** – `Shift+Enter` creates the typed path (nested folders included) and moves the note there.
- **Tracks every move** – the plugin's own "Move to…" menu, drag and drop in the file explorer and the built-in move command all count (the last two can be turned off). Moving several files at once counts as one move.
- **Usage stats** – settings list every folder's move count, score and last use.
- **Multi-select** – right-click several files in the file explorer and move them together.
- Folder renames and deletions keep the history in sync. Links are updated through Obsidian's own file manager.
- Chinese and English UI, following Obsidian's language setting.

## Ranking

Each move into a folder adds one point that decays over time:

```
weight(age) = 0.995 × 0.5^(age / 45 days) + 0.005 × 0.5^(age / 180 days)
score       = Σ weight over all moves into the folder
```

More moves add more terms and recent moves weigh more, so both frequency and recency count. The small 180-day term lets a folder you used a few times recently fall back behind a long-time favourite once you stop using it. Ties go to the most recently used folder. History from 1.0 is kept in its original order.

## Usage

- Command palette: **Recent Folder Move: Move current file (recent folders first)**
- File explorer / editor menu: **Move to… (recent first)**

Tip: in *Settings → Hotkeys*, remove the hotkey from the built-in "Move current file to another folder" and assign it to this plugin's command.

| Key | Action |
| --- | --- |
| `↑` `↓` | Navigate |
| `Enter` | Move |
| `Shift+Enter` | Create the typed folder and move |
| `Shift+Alt+Enter` | Pin / unpin the selected folder |
| `Esc` | Close |

## Installation

### BRAT (before it is in the community directory)

1. Install **BRAT** from Community plugins.
2. BRAT → *Add beta plugin* → paste this repository's URL.
3. Enable **Recent Folder Move**.

### Manual

Download `main.js`, `manifest.json` and `styles.css` from the latest release into `<vault>/.obsidian/plugins/recent-folder-move/`, then enable the plugin.

## Releasing

Bump `version` in `manifest.json` and `versions.json`, commit, then push a tag with the same version (no `v` prefix). The GitHub Action publishes the release.

## License

MIT
