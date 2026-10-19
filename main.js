"use strict";

const {
  Plugin,
  FuzzySuggestModal,
  PluginSettingTab,
  Setting,
  Notice,
  TFile,
  TFolder,
  normalizePath,
  prepareFuzzySearch,
  renderResults,
  moment,
} = require("obsidian");

/* ------------------------------------------------------------------ */
/* i18n                                                                */
/* ------------------------------------------------------------------ */

const STRINGS = {
  zh: {
    cmdMove: "移动当前文件（最近使用的文件夹优先）",
    menuMove: "移动到…（最近优先）",
    placeholder: "输入文件夹名称",
    navigate: "导航",
    move: "移动",
    create: "新建并移动",
    pin: "置顶/取消置顶",
    esc: "退出",
    badgeRecent: "常用",
    badgePinned: "置顶",
    moved: (n, p) => (n === 1 ? `已移动到 ${p}` : `已将 ${n} 项移动到 ${p}`),
    nothingToCreate: "请先输入要新建的文件夹路径",
    failed: (msg) => `移动失败：${msg}`,
    skipped: (n) => `有 ${n} 项因目标冲突或无法移入自身而跳过`,
    sRecentLimit: "置顶显示的常用文件夹数",
    sRecentLimitDesc: "搜索框为空时，按「转移次数 + 时间加权」得分最高的这几个文件夹排在最前。",
    sHistory: "最多记住多少个文件夹",
    sHistoryDesc: "超出后得分最低的会被遗忘。",
    sTrack: "记录在文件列表里拖拽或用原生命令的移动",
    sTrackDesc: "开启后，拖入文件夹、原生「移动文件到…」也计入转移次数。一次拖拽多个文件只算一次。",
    sBoost: "搜索时也优先常用文件夹",
    sBoostDesc: "输入关键词后，匹配度相近的结果中得分高的排在前面。",
    sPinned: "固定置顶的文件夹",
    sPinnedDesc: "每行一个路径，始终排在最前；也可以在弹窗中按 Shift+Alt+Enter 切换。",
    sExcluded: "排除的文件夹",
    sExcludedDesc: "每行一个路径，该文件夹及其子文件夹都不会出现在列表中。",
    sClear: "清空使用记录",
    sClearBtn: "清空",
    cleared: "使用记录已清空",
    sStats: "使用统计",
    sStatsEmpty: "还没有转移记录。",
    sStatsDesc: "每次转移记 1 分，之后随时间衰减（99.5% 按 45 天半衰期、0.5% 按 180 天半衰期）。得分 = 所有转移的衰减值之和，所以转得越多、越近，排得越前。",
    statLine: (n, score, last) => `转移 ${n} 次 · 得分 ${score} · 上次 ${last}`,
    badgeTitle: (n) => `转移 ${n} 次`,
    pinned: (p) => `已置顶 ${p}`,
    unpinned: (p) => `已取消置顶 ${p}`,
  },
  en: {
    cmdMove: "Move current file (recent folders first)",
    menuMove: "Move to… (recent first)",
    placeholder: "Type a folder name",
    navigate: "navigate",
    move: "move",
    create: "create & move",
    pin: "pin / unpin",
    esc: "dismiss",
    badgeRecent: "frequent",
    badgePinned: "pinned",
    moved: (n, p) => (n === 1 ? `Moved to ${p}` : `Moved ${n} items to ${p}`),
    nothingToCreate: "Type the path of the folder to create first",
    failed: (msg) => `Move failed: ${msg}`,
    skipped: (n) => `Skipped ${n} item(s) because of a name clash or moving a folder into itself`,
    sRecentLimit: "Frequent folders shown on top",
    sRecentLimitDesc: "With an empty query, this many folders with the highest frequency-and-recency score are listed first.",
    sHistory: "History size",
    sHistoryDesc: "Lowest-scoring folders beyond this are forgotten.",
    sTrack: "Track moves made elsewhere",
    sTrackDesc: "Count drag-and-drop in the file explorer and the built-in move command as moves. Dragging several files at once counts once.",
    sBoost: "Prefer frequent folders while searching",
    sBoostDesc: "Among similarly good matches, higher-scoring folders rank higher.",
    sPinned: "Pinned folders",
    sPinnedDesc: "One path per line, always listed first. You can also toggle with Shift+Alt+Enter in the dialog.",
    sExcluded: "Excluded folders",
    sExcludedDesc: "One path per line. These folders and their subfolders are hidden.",
    sClear: "Clear history",
    sClearBtn: "Clear",
    cleared: "History cleared",
    sStats: "Usage",
    sStatsEmpty: "No moves recorded yet.",
    sStatsDesc: "Each move adds 1 point that decays over time (99.5% with a 45-day half-life, 0.5% with a 180-day half-life). A folder's score is the sum, so more moves and more recent moves both rank higher.",
    statLine: (n, score, last) => `${n} move(s) · score ${score} · last ${last}`,
    badgeTitle: (n) => `${n} move(s)`,
    pinned: (p) => `Pinned ${p}`,
    unpinned: (p) => `Unpinned ${p}`,
  },
};

function t() {
  let locale = "en";
  try {
    locale = (moment && moment.locale && moment.locale()) || "en";
  } catch (e) {
    /* ignore */
  }
  return locale.toLowerCase().startsWith("zh") ? STRINGS.zh : STRINGS.en;
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function defaultSettings() {
  return {
    recentLimit: 8,
    historySize: 50,
    trackExternalMoves: true,
    boostWhileSearching: true,
    pinned: [],
    excluded: [],
    // folder path ("/" = vault root) -> usage entry, see `recordUse`
    usage: {},
  };
}

/* ------------------------------------------------------------------ */
/* frequency + recency score                                           */
/* ------------------------------------------------------------------ */

// A folder's score is the sum over all moves into it of
//   0.995 * 0.5^(age / 45 days) + 0.005 * 0.5^(age / 180 days)
// so more moves and more recent moves both rank higher. The slow 0.5% term
// lets a folder that was used a few times recently fall back behind a
// long-time favourite once you stop using it; with a single exponential the
// order would never change without new moves.
//
// Both terms are plain exponentials, so each sum can be stored as one number
// "as of" a timestamp and aged forward on demand: storage per folder is O(1)
// no matter how many moves were made.
const DAY_MS = 86400000;
const RECENT_HALF_LIFE_DAYS = 45;
const LONG_HALF_LIFE_DAYS = 180;
const LONG_WEIGHT = 0.005;
// Drag-and-drop of several files fires one rename per file; renames into the
// same folder this close together count as a single move.
const COALESCE_MS = 2000;

function decayFactor(ms, halfLifeDays) {
  return Math.pow(0.5, ms / (halfLifeDays * DAY_MS));
}

/** The entry's two sums aged forward to `now` (never backwards if the clock jumped). */
function ageEntry(entry, now) {
  const dt = now - entry.at;
  if (!(dt > 0)) return entry;
  return {
    n: entry.n,
    fast: entry.fast * decayFactor(dt, RECENT_HALF_LIFE_DAYS),
    slow: entry.slow * decayFactor(dt, LONG_HALF_LIFE_DAYS),
    at: now,
    last: entry.last,
  };
}

function scoreOf(entry, now) {
  if (!entry) return 0;
  const aged = ageEntry(entry, now);
  return (1 - LONG_WEIGHT) * aged.fast + LONG_WEIGHT * aged.slow;
}

/** Entry after one more move at `now`. `n` is the raw move count, `last` the last move time. */
function recordUse(entry, now) {
  const aged = entry ? ageEntry(entry, now) : { n: 0, fast: 0, slow: 0, at: now, last: 0 };
  return {
    n: aged.n + 1,
    fast: aged.fast + 1,
    slow: aged.slow + 1,
    at: Math.max(aged.at, now),
    last: Math.max(aged.last, now),
  };
}

/** Two entries combined, e.g. when a folder is renamed onto a path that already had history. */
function mergeEntries(a, b) {
  const now = Math.max(a.at, b.at);
  const x = ageEntry(a, now);
  const y = ageEntry(b, now);
  return { n: x.n + y.n, fast: x.fast + y.fast, slow: x.slow + y.slow, at: now, last: Math.max(x.last, y.last) };
}

function isValidEntry(e) {
  return (
    e && typeof e === "object" &&
    [e.n, e.fast, e.slow, e.at, e.last].every((v) => typeof v === "number" && isFinite(v))
  );
}

/** Folder paths with history, highest score first; ties go to the most recent move, then path. */
function rankUsage(usage, now) {
  return Object.keys(usage)
    .map((path) => ({ path, score: scoreOf(usage[path], now), last: usage[path].last }))
    .sort((a, b) => b.score - a.score || b.last - a.last || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/**
 * Version 1.0 kept only a most-recent-first list. Keep that order by seeding
 * each folder as if it had been used once, one day apart; real moves take over quickly.
 */
function usageFromRecentList(recent, now) {
  const usage = {};
  recent.forEach((path, i) => {
    if (typeof path !== "string" || usage[path]) return;
    const at = now - i * DAY_MS;
    usage[path] = ageEntry({ n: 1, fast: 1, slow: 1, at, last: at }, now);
  });
  return usage;
}

function parentPath(path) {
  const i = path.lastIndexOf("/");
  return i <= 0 ? "/" : path.slice(0, i);
}

function displayPath(path) {
  return path === "/" || path === "" ? "/" : path;
}

function isSameOrInside(path, folder) {
  if (folder === "/") return true;
  return path === folder || path.startsWith(folder + "/");
}

function joinPath(folder, name) {
  return folder === "/" ? name : normalizePath(folder + "/" + name);
}

function linesToList(text) {
  return text
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (s === "/" ? "/" : normalizePath(s)));
}

/* ------------------------------------------------------------------ */
/* modal                                                               */
/* ------------------------------------------------------------------ */

class RecentFolderModal extends FuzzySuggestModal {
  constructor(app, plugin, files) {
    super(app);
    this.plugin = plugin;
    this.files = files;
    const s = t();
    this.setPlaceholder(s.placeholder);
    this.setInstructions([
      { command: "↑↓", purpose: s.navigate },
      { command: "↵", purpose: s.move },
      { command: "shift ↵", purpose: s.create },
      { command: "shift alt ↵", purpose: s.pin },
      { command: "esc", purpose: s.esc },
    ]);

    this.scope.register(["Shift"], "Enter", (evt) => {
      evt.preventDefault();
      this.createAndMove();
      return false;
    });
    this.scope.register(["Shift", "Alt"], "Enter", (evt) => {
      evt.preventDefault();
      this.togglePinSelected();
      return false;
    });
  }

  /** All candidate folders, in the vault's natural order, minus excluded / invalid ones. */
  getItems() {
    const vault = this.app.vault;
    let folders;
    if (typeof vault.getAllFolders === "function") {
      folders = vault.getAllFolders(true);
    } else {
      folders = vault.getAllLoadedFiles().filter((f) => f instanceof TFolder);
    }
    const excluded = this.plugin.settings.excluded;
    const singleParent =
      this.files.length === 1 && this.files[0].parent ? this.files[0].parent.path : null;
    const movingFolders = this.files.filter((f) => f instanceof TFolder).map((f) => f.path);

    return folders.filter((folder) => {
      const p = folder.isRoot() ? "/" : folder.path;
      if (excluded.some((ex) => ex !== "/" && isSameOrInside(p, ex))) return false;
      if (singleParent !== null && (singleParent === p || (singleParent === "" && p === "/"))) return false;
      if (movingFolders.some((mf) => p !== "/" && isSameOrInside(p, mf))) return false;
      return true;
    });
  }

  getItemText(folder) {
    return folder.isRoot() ? "/" : folder.path;
  }

  /**
   * Score order of every folder with history, plus the top `recentLimit` of
   * them that are actually listable here (not pinned, not excluded, not the
   * file's own folder). Those get the "recent" tier and badge.
   */
  computeRanking(items) {
    const settings = this.plugin.settings;
    const ranked = rankUsage(settings.usage, Date.now()).filter((r) => r.score > 0);
    this.usageRank = new Map(ranked.map((r, i) => [r.path, i]));
    const listable = new Set(items.map((item) => this.getItemText(item)));
    const limit = Math.max(0, settings.recentLimit);
    this.topPaths = new Map();
    for (const r of ranked) {
      if (this.topPaths.size >= limit) break;
      if (listable.has(r.path) && !settings.pinned.includes(r.path)) this.topPaths.set(r.path, this.topPaths.size);
    }
  }

  /** Rank: pinned > top scored > everything else. `idx` orders within a tier. */
  rankOf(path) {
    const pi = this.plugin.settings.pinned.indexOf(path);
    if (pi !== -1) return { tier: 0, idx: pi };
    const ti = this.topPaths.get(path);
    if (ti !== undefined) return { tier: 1, idx: ti };
    return { tier: 2, idx: 0 };
  }

  getSuggestions(query) {
    const items = this.getItems();
    const settings = this.plugin.settings;
    const q = query.trim();
    this.computeRanking(items);

    if (!q) {
      const decorated = items.map((item, natural) => {
        const { tier, idx } = this.rankOf(this.getItemText(item));
        return { item, tier, idx: tier === 2 ? natural : idx };
      });
      decorated.sort((a, b) => a.tier - b.tier || a.idx - b.idx);
      return decorated.map((d) => ({ item: d.item, match: { score: 0, matches: [] } }));
    }

    const search = prepareFuzzySearch(q);
    const results = [];
    items.forEach((item, natural) => {
      const match = search(this.getItemText(item));
      if (match) results.push({ item, match, natural });
    });

    const boost = settings.boostWhileSearching;
    const historySize = Math.max(1, settings.historySize);
    const effective = (r) => {
      if (!boost) return r.match.score;
      const path = this.getItemText(r.item);
      // Small bonus that only reorders near-ties: pinned > higher score > lower score.
      if (settings.pinned.includes(path)) return r.match.score + 1;
      const ri = this.usageRank.get(path);
      if (ri !== undefined) return r.match.score + 0.8 * Math.max(0, 1 - ri / historySize);
      return r.match.score;
    };
    results.sort((a, b) => effective(b) - effective(a) || a.natural - b.natural);
    return results.map((r) => ({ item: r.item, match: r.match }));
  }

  renderSuggestion(result, el) {
    const path = this.getItemText(result.item);
    el.addClass("rfm-suggestion");
    const textEl = el.createDiv({ cls: "rfm-path" });
    renderResults(textEl, path, result.match);

    const s = t();
    const { pinned, usage } = this.plugin.settings;
    if (pinned.includes(path)) {
      el.createSpan({ cls: "rfm-badge rfm-badge-pinned", text: s.badgePinned });
    } else if (this.topPaths && this.topPaths.has(path)) {
      const badge = el.createSpan({ cls: "rfm-badge rfm-badge-recent", text: s.badgeRecent });
      if (usage[path]) badge.setAttribute("title", s.badgeTitle(usage[path].n));
    }
  }

  onChooseItem(folder) {
    this.plugin.moveFiles(this.files, folder);
  }

  selectedFolder() {
    const chooser = this.chooser;
    if (!chooser || !chooser.values) return null;
    const v = chooser.values[chooser.selectedItem];
    return v ? v.item : null;
  }

  async togglePinSelected() {
    const folder = this.selectedFolder();
    if (!folder) return;
    const path = this.getItemText(folder);
    const s = t();
    const pinned = this.plugin.settings.pinned;
    const i = pinned.indexOf(path);
    if (i === -1) {
      pinned.push(path);
      new Notice(s.pinned(path));
    } else {
      pinned.splice(i, 1);
      new Notice(s.unpinned(path));
    }
    await this.plugin.saveSettings();
    // Re-render the list in place.
    this.inputEl.dispatchEvent(new Event("input"));
  }

  async createAndMove() {
    const s = t();
    const raw = this.inputEl.value.trim().replace(/^\/+|\/+$/g, "");
    if (!raw) {
      new Notice(s.nothingToCreate);
      return;
    }
    const path = normalizePath(raw);
    try {
      const folder = await this.plugin.ensureFolder(path);
      this.close();
      await this.plugin.moveFiles(this.files, folder);
    } catch (e) {
      console.error(e);
      new Notice(s.failed(e && e.message ? e.message : String(e)));
    }
  }
}

/* ------------------------------------------------------------------ */
/* plugin                                                              */
/* ------------------------------------------------------------------ */

class RecentFolderMovePlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    this.internalMoveDepth = 0;
    const s = t();

    this.addCommand({
      id: "move-current-file",
      name: s.cmdMove,
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file) return false;
        if (!checking) new RecentFolderModal(this.app, this, [file]).open();
        return true;
      },
    });

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file, source) => {
        if (source === "link-context-menu") return;
        menu.addItem((item) =>
          item
            .setTitle(s.menuMove)
            .setIcon("folder-input")
            .setSection("action")
            .onClick(() => new RecentFolderModal(this.app, this, [file]).open())
        );
      })
    );

    this.registerEvent(
      this.app.workspace.on("files-menu", (menu, files) => {
        if (!files || !files.length) return;
        menu.addItem((item) =>
          item
            .setTitle(s.menuMove)
            .setIcon("folder-input")
            .setSection("action")
            .onClick(() => new RecentFolderModal(this.app, this, files).open())
        );
      })
    );

    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => this.onRename(file, oldPath)));
    this.registerEvent(this.app.vault.on("delete", (file) => this.onDelete(file)));

    this.addSettingTab(new RecentFolderMoveSettingTab(this.app, this));
  }

  async loadSettings() {
    const data = (await this.loadData()) || {};
    const settings = Object.assign(defaultSettings(), data);
    for (const key of ["pinned", "excluded"]) {
      if (!Array.isArray(settings[key])) settings[key] = [];
    }

    let migrated = false;
    const stored = data.usage;
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
      settings.usage = Array.isArray(data.recent) ? usageFromRecentList(data.recent, Date.now()) : {};
      migrated = true;
    }
    if ("recent" in settings) {
      delete settings.recent;
      migrated = true;
    }
    for (const path of Object.keys(settings.usage)) {
      if (!isValidEntry(settings.usage[path])) delete settings.usage[path];
    }

    this.settings = settings;
    if (migrated) await this.saveSettings();
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  /** Forget the lowest-scoring folders beyond `historySize`. */
  pruneUsage() {
    const keep = Math.max(1, this.settings.historySize);
    const ranked = rankUsage(this.settings.usage, Date.now());
    for (const r of ranked.slice(keep)) delete this.settings.usage[r.path];
  }

  /** Count one move into a folder. */
  async touch(folderPath) {
    const p = folderPath === "" ? "/" : folderPath;
    const usage = this.settings.usage;
    usage[p] = recordUse(usage[p], Date.now());
    this.pruneUsage();
    await this.saveSettings();
  }

  async ensureFolder(path) {
    const vault = this.app.vault;
    const existing = vault.getAbstractFileByPath(path);
    if (existing instanceof TFolder) return existing;
    if (existing) throw new Error(`${path} exists and is not a folder`);
    const parts = path.split("/");
    let cur = "";
    for (const part of parts) {
      cur = cur ? `${cur}/${part}` : part;
      const f = vault.getAbstractFileByPath(cur);
      if (!f) await vault.createFolder(cur);
      else if (!(f instanceof TFolder)) throw new Error(`${cur} exists and is not a folder`);
    }
    return vault.getAbstractFileByPath(path);
  }

  async moveFiles(files, folder) {
    const s = t();
    const dest = folder.isRoot() ? "/" : folder.path;
    let moved = 0;
    let skipped = 0;
    this.internalMoveDepth++;
    try {
      for (const file of files) {
        if (file instanceof TFolder && dest !== "/" && isSameOrInside(dest, file.path)) {
          skipped++;
          continue;
        }
        const target = joinPath(dest, file.name);
        if (target === file.path) continue;
        if (this.app.vault.getAbstractFileByPath(target)) {
          skipped++;
          continue;
        }
        try {
          await this.app.fileManager.renameFile(file, target);
          moved++;
        } catch (e) {
          console.error(e);
          new Notice(s.failed(e && e.message ? e.message : String(e)));
        }
      }
    } finally {
      this.internalMoveDepth--;
    }
    if (moved > 0) {
      await this.touch(dest);
      new Notice(s.moved(moved, displayPath(dest)));
    }
    if (skipped > 0) new Notice(s.skipped(skipped));
  }

  async onRename(file, oldPath) {
    const settings = this.settings;
    let changed = false;

    // Keep stored folder paths in sync when a folder is renamed or moved.
    if (file instanceof TFolder) {
      const remap = (list) =>
        list.map((p) => {
          if (p === oldPath) {
            changed = true;
            return file.path;
          }
          if (p.startsWith(oldPath + "/")) {
            changed = true;
            return file.path + p.slice(oldPath.length);
          }
          return p;
        });
      const usage = {};
      for (const [p, entry] of Object.entries(settings.usage)) {
        const [q] = remap([p]);
        // Merge in case the new path already had history of its own.
        usage[q] = usage[q] ? mergeEntries(usage[q], entry) : entry;
      }
      settings.usage = usage;
      settings.pinned = remap(settings.pinned);
      settings.excluded = remap(settings.excluded);
    }

    // Count moves done elsewhere (drag & drop, built-in "Move file to…") as usage.
    if (settings.trackExternalMoves && this.internalMoveDepth === 0) {
      const oldParent = parentPath(oldPath);
      const newParent = file.parent ? (file.parent.isRoot() ? "/" : file.parent.path) : "/";
      // Only when the item itself changed folder (not a plain rename), and not because
      // an ancestor folder was renamed: then the old parent path no longer exists.
      const oldParentStillExists =
        oldParent === "/" || this.app.vault.getAbstractFileByPath(oldParent) instanceof TFolder;
      if (oldParent !== newParent && oldParentStillExists) {
        // Several files dragged together arrive as a burst of renames: count the burst once.
        const now = Date.now();
        const last = this.lastExternalMove;
        this.lastExternalMove = { dest: newParent, time: now };
        if (last && last.dest === newParent && now - last.time < COALESCE_MS) {
          if (changed) await this.saveSettings();
          return;
        }
        await this.touch(newParent);
        return;
      }
    }

    if (changed) await this.saveSettings();
  }

  async onDelete(file) {
    if (!(file instanceof TFolder)) return;
    const p = file.path;
    let changed = false;
    for (const x of Object.keys(this.settings.usage)) {
      if (x !== "/" && isSameOrInside(x, p)) {
        delete this.settings.usage[x];
        changed = true;
      }
    }
    if (changed) await this.saveSettings();
  }
}

/* ------------------------------------------------------------------ */
/* settings tab                                                        */
/* ------------------------------------------------------------------ */

class RecentFolderMoveSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    const s = t();
    const settings = this.plugin.settings;
    containerEl.empty();

    new Setting(containerEl)
      .setName(s.sRecentLimit)
      .setDesc(s.sRecentLimitDesc)
      .addSlider((sl) =>
        sl
          .setLimits(0, 30, 1)
          .setValue(settings.recentLimit)
          .setDynamicTooltip()
          .onChange(async (v) => {
            settings.recentLimit = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(s.sHistory)
      .setDesc(s.sHistoryDesc)
      .addSlider((sl) =>
        sl
          .setLimits(10, 200, 10)
          .setValue(settings.historySize)
          .setDynamicTooltip()
          .onChange(async (v) => {
            settings.historySize = v;
            this.plugin.pruneUsage();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(s.sTrack)
      .setDesc(s.sTrackDesc)
      .addToggle((tg) =>
        tg.setValue(settings.trackExternalMoves).onChange(async (v) => {
          settings.trackExternalMoves = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName(s.sBoost)
      .setDesc(s.sBoostDesc)
      .addToggle((tg) =>
        tg.setValue(settings.boostWhileSearching).onChange(async (v) => {
          settings.boostWhileSearching = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName(s.sPinned)
      .setDesc(s.sPinnedDesc)
      .addTextArea((ta) => {
        ta.inputEl.rows = 4;
        ta.inputEl.addClass("rfm-textarea");
        ta.setValue(settings.pinned.join("\n")).onChange(async (v) => {
          settings.pinned = linesToList(v);
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName(s.sExcluded)
      .setDesc(s.sExcludedDesc)
      .addTextArea((ta) => {
        ta.inputEl.rows = 4;
        ta.inputEl.addClass("rfm-textarea");
        ta.setValue(settings.excluded.join("\n")).onChange(async (v) => {
          settings.excluded = linesToList(v);
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl).setName(s.sClear).addButton((b) =>
      b
        .setButtonText(s.sClearBtn)
        .setWarning()
        .onClick(async () => {
          settings.usage = {};
          await this.plugin.saveSettings();
          new Notice(s.cleared);
          this.display();
        })
    );

    new Setting(containerEl).setName(s.sStats).setDesc(s.sStatsDesc).setHeading();
    const now = Date.now();
    const ranked = rankUsage(settings.usage, now);
    if (!ranked.length) {
      containerEl.createEl("p", { cls: "setting-item-description", text: s.sStatsEmpty });
    }
    for (const r of ranked) {
      const entry = settings.usage[r.path];
      new Setting(containerEl)
        .setName(displayPath(r.path))
        .setDesc(s.statLine(entry.n, r.score.toFixed(2), moment(entry.last).format("YYYY-MM-DD")));
    }
  }
}

module.exports = RecentFolderMovePlugin;
module.exports.default = RecentFolderMovePlugin;
module.exports._internals = {
  RecentFolderModal,
  parentPath,
  isSameOrInside,
  joinPath,
  linesToList,
  scoreOf,
  recordUse,
  mergeEntries,
  rankUsage,
  usageFromRecentList,
};
