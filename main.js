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
    badgeRecent: "最近",
    badgePinned: "置顶",
    moved: (n, p) => (n === 1 ? `已移动到 ${p}` : `已将 ${n} 项移动到 ${p}`),
    nothingToCreate: "请先输入要新建的文件夹路径",
    failed: (msg) => `移动失败：${msg}`,
    skipped: (n) => `有 ${n} 项因目标冲突或无法移入自身而跳过`,
    sRecentLimit: "置顶显示的最近文件夹数",
    sRecentLimitDesc: "搜索框为空时，最近用过的这几个文件夹排在最前。",
    sHistory: "最多记住多少个文件夹",
    sHistoryDesc: "超出后最久未用的会被遗忘。",
    sTrack: "记录在文件列表里拖拽或用原生命令的移动",
    sTrackDesc: "开启后，不论用什么方式把笔记移入某个文件夹，都会计入最近使用。",
    sBoost: "搜索时也优先最近使用的文件夹",
    sBoostDesc: "输入关键词后，匹配度相近的结果中最近使用的排在前面。",
    sPinned: "固定置顶的文件夹",
    sPinnedDesc: "每行一个路径，始终排在最前；也可以在弹窗中按 Shift+Alt+Enter 切换。",
    sExcluded: "排除的文件夹",
    sExcludedDesc: "每行一个路径，该文件夹及其子文件夹都不会出现在列表中。",
    sClear: "清空最近使用记录",
    sClearBtn: "清空",
    cleared: "最近使用记录已清空",
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
    badgeRecent: "recent",
    badgePinned: "pinned",
    moved: (n, p) => (n === 1 ? `Moved to ${p}` : `Moved ${n} items to ${p}`),
    nothingToCreate: "Type the path of the folder to create first",
    failed: (msg) => `Move failed: ${msg}`,
    skipped: (n) => `Skipped ${n} item(s) because of a name clash or moving a folder into itself`,
    sRecentLimit: "Recent folders shown on top",
    sRecentLimitDesc: "With an empty query, this many recently used folders are listed first.",
    sHistory: "History size",
    sHistoryDesc: "Least recently used folders beyond this are forgotten.",
    sTrack: "Track moves made elsewhere",
    sTrackDesc: "Count drag-and-drop in the file explorer and the built-in move command as usage.",
    sBoost: "Prefer recent folders while searching",
    sBoostDesc: "Among similarly good matches, recently used folders rank higher.",
    sPinned: "Pinned folders",
    sPinnedDesc: "One path per line, always listed first. You can also toggle with Shift+Alt+Enter in the dialog.",
    sExcluded: "Excluded folders",
    sExcludedDesc: "One path per line. These folders and their subfolders are hidden.",
    sClear: "Clear history",
    sClearBtn: "Clear",
    cleared: "History cleared",
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

const DEFAULT_SETTINGS = {
  recentLimit: 8,
  historySize: 50,
  trackExternalMoves: true,
  boostWhileSearching: true,
  pinned: [],
  excluded: [],
  recent: [], // most recent first, array of folder paths ("/" = vault root)
};

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

  /** Rank: pinned > recent (by recency) > everything else (natural order). */
  rankOf(path) {
    const { pinned, recent } = this.plugin.settings;
    const pi = pinned.indexOf(path);
    if (pi !== -1) return { tier: 0, idx: pi };
    const ri = recent.indexOf(path);
    if (ri !== -1) return { tier: 1, idx: ri };
    return { tier: 2, idx: 0 };
  }

  getSuggestions(query) {
    const items = this.getItems();
    const settings = this.plugin.settings;
    const q = query.trim();

    if (!q) {
      const limit = Math.max(0, settings.recentLimit);
      const recentTop = settings.recent.slice(0, limit);
      const decorated = items.map((item, natural) => {
        const path = this.getItemText(item);
        let tier = 2;
        let idx = natural;
        const pi = settings.pinned.indexOf(path);
        const ri = recentTop.indexOf(path);
        if (pi !== -1) {
          tier = 0;
          idx = pi;
        } else if (ri !== -1) {
          tier = 1;
          idx = ri;
        }
        return { item, tier, idx };
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
      const { tier, idx } = this.rankOf(path);
      // Small bonus that only reorders near-ties: pinned > more recent > older.
      if (tier === 0) return r.match.score + 1;
      if (tier === 1) return r.match.score + 0.8 * (1 - idx / historySize);
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
    const { pinned, recent, recentLimit } = this.plugin.settings;
    if (pinned.includes(path)) {
      el.createSpan({ cls: "rfm-badge rfm-badge-pinned", text: s.badgePinned });
    } else {
      const ri = recent.indexOf(path);
      if (ri !== -1 && ri < Math.max(recentLimit, 1)) {
        el.createSpan({ cls: "rfm-badge rfm-badge-recent", text: s.badgeRecent });
      }
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
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
    for (const key of ["pinned", "excluded", "recent"]) {
      if (!Array.isArray(this.settings[key])) this.settings[key] = [];
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  /** Move a folder path to the front of the recency list. */
  async touch(folderPath) {
    const p = folderPath === "" ? "/" : folderPath;
    const recent = this.settings.recent.filter((x) => x !== p);
    recent.unshift(p);
    this.settings.recent = recent.slice(0, Math.max(1, this.settings.historySize));
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
      settings.recent = remap(settings.recent);
      settings.pinned = remap(settings.pinned);
      settings.excluded = remap(settings.excluded);
      // De-duplicate in case of collisions.
      settings.recent = settings.recent.filter((p, i, a) => a.indexOf(p) === i);
    }

    // Count moves done elsewhere (drag & drop, built-in command) as usage.
    if (settings.trackExternalMoves && this.internalMoveDepth === 0 && file instanceof TFile) {
      const oldParent = parentPath(oldPath);
      const newParent = file.parent ? (file.parent.isRoot() ? "/" : file.parent.path) : "/";
      // Only when the file itself changed folder, and not because its ancestor folder was renamed.
      const oldParentStillExists =
        oldParent === "/" || this.app.vault.getAbstractFileByPath(oldParent) instanceof TFolder;
      if (oldParent !== newParent && oldParentStillExists) {
        await this.touch(newParent);
        return;
      }
    }

    if (changed) await this.saveSettings();
  }

  async onDelete(file) {
    if (!(file instanceof TFolder)) return;
    const p = file.path;
    const before = this.settings.recent.length;
    this.settings.recent = this.settings.recent.filter((x) => !isSameOrInside(x, p) || x === "/");
    if (this.settings.recent.length !== before) await this.saveSettings();
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
            settings.recent = settings.recent.slice(0, v);
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
          settings.recent = [];
          await this.plugin.saveSettings();
          new Notice(s.cleared);
        })
    );
  }
}

module.exports = RecentFolderMovePlugin;
module.exports.default = RecentFolderMovePlugin;
module.exports._internals = { RecentFolderModal, parentPath, isSameOrInside, joinPath, linesToList };
