# Recent Folder Move

An Obsidian plugin that replaces the folder picker of "Move file to…" with one that lists your **most recently used folders first**.

Obsidian's built-in move dialog always lists folders in the same fixed order, so filing notes into a handful of active folders means typing or scrolling every time. This plugin remembers where you move things and puts those folders at the top.

## Features

- **Recent first** – with an empty query, the folders you moved notes into most recently appear at the top, marked "recent".
- **Recency-aware search** – when you type, results are ranked by fuzzy match, with recently used folders winning near-ties.
- **Pinned folders** – always listed first. Pin from settings or press `Shift+Alt+Enter` on a folder in the dialog.
- **Excluded folders** – hide folders such as `attachments` (and their subfolders) from the list.
- **Create on the fly** – `Shift+Enter` creates the typed path (nested folders included) and moves the note there.
- **Tracks every move** – drag and drop in the file explorer and the built-in move command also count as usage (optional).
- **Multi-select** – right-click several files in the file explorer and move them together.
- Folder renames and deletions keep the history in sync. Links are updated through Obsidian's own file manager.
- Chinese and English UI, following Obsidian's language setting.

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
