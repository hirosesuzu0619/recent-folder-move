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
  Platform,
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
    sRecentLimit: "标记「常用」的文件夹数",
    sRecentLimitDesc: "搜索框为空时，所有转移过的文件夹都按「转移次数 + 时间加权」得分从高到低排在前面，没转移过的排在后面；得分最高的这几个另外标上「常用」。",
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
    sStatsDesc: "每次转移记 1 分，之后随时间衰减（99.5% 按 14 天半衰期、0.5% 按 60 天半衰期）。得分 = 所有转移的衰减值之和，所以转得越多、越近，排得越前。",
    sStatsDevices: (names) => `每台设备只写自己的记录文件（插件目录下的 devices 文件夹），随库同步后合并显示。已合并：${names.join("、")}。清空会对所有设备生效。`,
    thisDevice: (name) => `${name}（本机）`,
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
    sRecentLimit: "Folders marked \"frequent\"",
    sRecentLimitDesc: "With an empty query, every folder you have moved notes into is listed first, by frequency-and-recency score, followed by the rest. The top ones also get a \"frequent\" badge.",
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
    sStatsDesc: "Each move adds 1 point that decays over time (99.5% with a 14-day half-life, 0.5% with a 60-day half-life). A folder's score is the sum, so more moves and more recent moves both rank higher.",
    sStatsDevices: (names) => `Each device writes only its own history file (the devices folder in the plugin directory); they are added up after the vault syncs. Included: ${names.join(", ")}. Clearing applies to every device.`,
    thisDevice: (name) => `${name} (this device)`,
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
    // when history was last cleared on any device; older device histories are dropped.
    // The histories themselves are in per-device files, see `devicesDir`.
    resetAt: 0,
  };
}

/* ------------------------------------------------------------------ */
/* frequency + recency score                                           */
/* ------------------------------------------------------------------ */

// A folder's score is the sum over all moves into it of
//   0.995 * 0.5^(age / 14 days) + 0.005 * 0.5^(age / 60 days)
// so more moves and more recent moves both rank higher. The slow 0.5% term
// lets a folder that was used a few times recently fall back behind a
// long-time favourite once you stop using it; with a single exponential the
// order would never change without new moves.
//
// Both terms are plain exponentials, so each sum can be stored as one number
// "as of" a timestamp and aged forward on demand: storage per folder is O(1)
// no matter how many moves were made.
const DAY_MS = 86400000;
const RECENT_HALF_LIFE_DAYS = 14;
const LONG_HALF_LIFE_DAYS = 60;
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

/* Per-device storage ------------------------------------------------ */
// Every device keeps its own history section { usage, since, name } and the
// ranking uses all sections added up (`mergeEntries` sums exactly).

function newDeviceId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

/** A readable label for this device, shown in the settings' usage section. */
function deviceName() {
  try {
    if (Platform.isIosApp) return Platform.isTablet ? "iPad" : "iPhone";
    if (Platform.isAndroidApp) return "Android";
    if (Platform.isMacOS) return "Mac";
    if (Platform.isWin) return "Windows";
    if (Platform.isLinux) return "Linux";
  } catch (e) {
    /* ignore */
  }
  return "";
}

function isValidSection(section) {
  return (
    section && typeof section === "object" &&
    section.usage && typeof section.usage === "object" && !Array.isArray(section.usage) &&
    typeof section.since === "number" && isFinite(section.since)
  );
}

/** Valid device sections only, each with its broken entries removed. */
function sanitizeDevices(devices) {
  const result = {};
  if (!devices || typeof devices !== "object" || Array.isArray(devices)) return result;
  for (const [id, section] of Object.entries(devices)) {
    if (!isValidSection(section)) continue;
    const usage = {};
    for (const [path, entry] of Object.entries(section.usage)) {
      if (isValidEntry(entry)) usage[path] = entry;
    }
    result[id] = { usage, since: section.since, name: typeof section.name === "string" ? section.name : "" };
  }
  return result;
}

/** All devices' usage summed into one map. */
function mergeDevices(devices) {
  const merged = {};
  for (const section of Object.values(devices)) {
    for (const [path, entry] of Object.entries(section.usage)) {
      merged[path] = merged[path] ? mergeEntries(merged[path], entry) : entry;
    }
  }
  return merged;
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
   * file's own folder). Those get the "frequent" badge.
   */
  computeRanking(items) {
    const settings = this.plugin.settings;
    const ranked = rankUsage(this.plugin.mergedUsage, Date.now()).filter((r) => r.score > 0);
    this.usageRank = new Map(ranked.map((r, i) => [r.path, i]));
    const listable = new Set(items.map((item) => this.getItemText(item)));
    const limit = Math.max(0, settings.recentLimit);
    this.topPaths = new Map();
    for (const r of ranked) {
      if (this.topPaths.size >= limit) break;
      if (listable.has(r.path) && !settings.pinned.includes(r.path)) this.topPaths.set(r.path, this.topPaths.size);
    }
  }

  /** Rank: pinned > every folder with history, by score > the rest. `idx` orders within a tier. */
  rankOf(path) {
    const pi = this.plugin.settings.pinned.indexOf(path);
    if (pi !== -1) return { tier: 0, idx: pi };
    const ri = this.usageRank.get(path);
    if (ri !== undefined) return { tier: 1, idx: ri };
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
    const { pinned } = this.plugin.settings;
    const usage = this.plugin.mergedUsage;
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
        if (!checking) this.openModal([file]);
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
            .onClick(() => this.openModal([file]))
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
            .onClick(() => this.openModal(files))
        );
      })
    );

    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => this.onRename(file, oldPath)));
    this.registerEvent(this.app.vault.on("delete", (file) => this.onDelete(file)));

    this.addSettingTab(new RecentFolderMoveSettingTab(this.app, this));
  }

  /**
   * A random id kept in this device's local storage, which no sync touches.
   * It names the one history file this device writes, see `devicesDir`.
   */
  loadDeviceId() {
    const key = "recent-folder-move-device-id";
    const app = this.app;
    let id = null;
    try {
      id = typeof app.loadLocalStorage === "function" ? app.loadLocalStorage(key) : window.localStorage.getItem(key);
    } catch (e) {
      /* ignore */
    }
    if (!id) {
      id = newDeviceId();
      try {
        if (typeof app.saveLocalStorage === "function") app.saveLocalStorage(key, id);
        else window.localStorage.setItem(key, id);
      } catch (e) {
        /* ignore */
      }
    }
    return id;
  }

  /**
   * Move history lives in one file per device:
   * `<config dir>/plugins/recent-folder-move/devices/<device id>.json`.
   *
   * Each file is only ever written by its own device, so file-level sync
   * (Google Drive, Remotely Save, …) never sees the same file changed on two
   * sides and never has to pick one version and drop the other. Reading adds
   * all the files up. data.json keeps only the shared options.
   */
  devicesDir() {
    const dir = (this.manifest && this.manifest.dir) || `${this.app.vault.configDir}/plugins/recent-folder-move`;
    return normalizePath(`${dir}/devices`);
  }

  deviceFile(id) {
    return `${this.devicesDir()}/${id}.json`;
  }

  /** Every device's history file that parses; a half-synced or broken one is skipped this round. */
  async readDeviceFiles() {
    const adapter = this.app.vault.adapter;
    const dir = this.devicesDir();
    const raw = {};
    if (!(await adapter.exists(dir))) return raw;
    const listing = await adapter.list(dir);
    for (const file of listing.files) {
      const name = file.slice(file.lastIndexOf("/") + 1);
      if (!name.endsWith(".json")) continue;
      try {
        raw[name.slice(0, -".json".length)] = JSON.parse(await adapter.read(file));
      } catch (e) {
        console.warn(`recent-folder-move: skipped ${file}`, e);
      }
    }
    return sanitizeDevices(raw);
  }

  async writeDeviceFile(id, section) {
    const adapter = this.app.vault.adapter;
    const dir = this.devicesDir();
    if (!(await adapter.exists(dir))) await adapter.mkdir(dir);
    await adapter.write(this.deviceFile(id), JSON.stringify(section));
  }

  newSection(resetAt) {
    return { usage: {}, since: Math.max(Date.now(), resetAt || 0), name: this.deviceLabel || "" };
  }

  /**
   * Apply a "clear history" made on any device: sections older than it are
   * hidden, and ours restarts empty. Returns true when our own section was reset.
   */
  applyReset() {
    const resetAt = this.settings.resetAt || 0;
    let ownReset = false;
    for (const id of Object.keys(this.devices)) {
      if (this.devices[id].since >= resetAt) continue;
      if (id === this.deviceId) {
        this.devices[id] = this.newSection(resetAt);
        ownReset = true;
      } else {
        delete this.devices[id]; // that device rewrites its file empty the next time it runs
      }
    }
    if (!this.devices[this.deviceId]) {
      this.devices[this.deviceId] = this.newSection(resetAt);
      ownReset = true;
    }
    return ownReset;
  }

  async loadSettings() {
    if (!this.deviceId) this.deviceId = this.loadDeviceId();
    if (this.deviceLabel === undefined) this.deviceLabel = deviceName();
    const data = (await this.loadData()) || {};
    const settings = Object.assign(defaultSettings(), data);
    for (const key of ["pinned", "excluded"]) {
      if (!Array.isArray(settings[key])) settings[key] = [];
    }
    if (typeof settings.resetAt !== "number" || !isFinite(settings.resetAt)) settings.resetAt = 0;

    // Older versions kept history inside data.json: 1.0 a `recent` list and 1.1 a
    // `usage` map (both become this device's history), 1.2 per-device `devices`
    // sections (each becomes that device's file).
    let legacy = null;
    if (data.usage && typeof data.usage === "object" && !Array.isArray(data.usage)) legacy = data.usage;
    else if (Array.isArray(data.recent)) legacy = usageFromRecentList(data.recent, Date.now());
    const legacySections = sanitizeDevices(data.devices);
    const migrated = "usage" in data || "recent" in data || "devices" in data;
    delete settings.usage;
    delete settings.recent;
    delete settings.devices;

    const devices = await this.readDeviceFiles();
    const toWrite = new Set();
    for (const [id, section] of Object.entries(legacySections)) {
      if (!devices[id]) {
        devices[id] = section;
        toWrite.add(id);
      }
    }
    // After the first load our own section in memory is the authority (only we
    // write it), so a reload racing with a move cannot lose that move.
    const current = this.devices && this.devices[this.deviceId];
    if (isValidSection(current)) devices[this.deviceId] = current;

    this.settings = settings;
    this.devices = devices;
    if (this.applyReset()) toWrite.add(this.deviceId);
    if (legacy) {
      const own = this.ownUsage();
      for (const [path, entry] of Object.entries(legacy)) {
        if (isValidEntry(entry)) own[path] = own[path] ? mergeEntries(own[path], entry) : entry;
      }
      toWrite.add(this.deviceId);
    }
    this.mergedUsage = mergeDevices(this.devices);

    for (const id of toWrite) await this.writeDeviceFile(id, this.devices[id]);
    if (migrated) await this.saveData(this.settings);
  }

  /** Save the shared options (data.json). Takes a newer "clear history" from disk into account. */
  async saveSettings() {
    const disk = (await this.loadData()) || {};
    if (typeof disk.resetAt === "number" && disk.resetAt > this.settings.resetAt) {
      this.settings.resetAt = disk.resetAt;
      if (this.applyReset()) await this.saveOwn();
    }
    this.mergedUsage = mergeDevices(this.devices);
    await this.saveData(this.settings);
  }

  /** Save this device's history file. */
  async saveOwn() {
    this.mergedUsage = mergeDevices(this.devices);
    await this.writeDeviceFile(this.deviceId, this.devices[this.deviceId]);
  }

  /** Called by Obsidian when data.json was changed from outside, e.g. by sync. */
  async onExternalSettingsChange() {
    await this.loadSettings();
  }

  /** Re-read the history files (small) so moves just synced from other devices count, then open the picker. */
  async openModal(files) {
    try {
      await this.loadSettings();
    } catch (e) {
      console.error(e);
    }
    new RecentFolderModal(this.app, this, files).open();
  }

  /** This device's own usage map: the only one this device ever writes. */
  ownUsage() {
    return this.devices[this.deviceId].usage;
  }

  /** Forget this device's lowest-scoring folders beyond `historySize`. */
  pruneUsage() {
    const keep = Math.max(1, this.settings.historySize);
    const usage = this.ownUsage();
    const ranked = rankUsage(usage, Date.now());
    for (const r of ranked.slice(keep)) delete usage[r.path];
  }

  /** Count one move into a folder. */
  async touch(folderPath) {
    const p = folderPath === "" ? "/" : folderPath;
    // Pick up a "clear history" from another device first; resetting our section
    // after recording would drop this move with it.
    const disk = (await this.loadData()) || {};
    if (typeof disk.resetAt === "number" && disk.resetAt > this.settings.resetAt) {
      this.settings.resetAt = disk.resetAt;
      this.applyReset();
    }
    const usage = this.ownUsage();
    usage[p] = recordUse(usage[p], Date.now());
    this.pruneUsage();
    await this.saveOwn();
  }

  /** Clear history on every device: each one empties its own file the next time it reads data.json. */
  async clearUsage() {
    this.settings.resetAt = Date.now();
    this.applyReset();
    await this.saveOwn();
    await this.saveData(this.settings);
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
    let ownChanged = false;

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
      // Only our own history: the other devices remap theirs when the rename syncs to them.
      const own = this.devices[this.deviceId];
      const usage = {};
      for (const [p, entry] of Object.entries(own.usage)) {
        const [q] = remap([p]);
        if (q !== p) ownChanged = true;
        // Merge in case the new path already had history of its own.
        usage[q] = usage[q] ? mergeEntries(usage[q], entry) : entry;
      }
      own.usage = usage;
      changed = false;
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
          if (ownChanged) await this.saveOwn();
          if (changed) await this.saveSettings();
          return;
        }
        if (changed) await this.saveSettings();
        await this.touch(newParent);
        return;
      }
    }

    if (ownChanged) await this.saveOwn();
    if (changed) await this.saveSettings();
  }

  async onDelete(file) {
    if (!(file instanceof TFolder)) return;
    const p = file.path;
    let changed = false;
    const usage = this.ownUsage();
    for (const x of Object.keys(usage)) {
      if (x !== "/" && isSameOrInside(x, p)) {
        delete usage[x];
        changed = true;
      }
    }
    if (changed) await this.saveOwn();
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
    // Re-read first so the usage list includes moves synced from other devices.
    this.plugin
      .loadSettings()
      .catch((e) => console.error(e))
      .then(() => this.render());
  }

  render() {
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
            this.plugin.settings.recentLimit = v;
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
            this.plugin.settings.historySize = v;
            this.plugin.pruneUsage();
            await this.plugin.saveOwn();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(s.sTrack)
      .setDesc(s.sTrackDesc)
      .addToggle((tg) =>
        tg.setValue(settings.trackExternalMoves).onChange(async (v) => {
          this.plugin.settings.trackExternalMoves = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName(s.sBoost)
      .setDesc(s.sBoostDesc)
      .addToggle((tg) =>
        tg.setValue(settings.boostWhileSearching).onChange(async (v) => {
          this.plugin.settings.boostWhileSearching = v;
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
          this.plugin.settings.pinned = linesToList(v);
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
          this.plugin.settings.excluded = linesToList(v);
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl).setName(s.sClear).addButton((b) =>
      b
        .setButtonText(s.sClearBtn)
        .setWarning()
        .onClick(async () => {
          await this.plugin.clearUsage();
          new Notice(s.cleared);
          this.display();
        })
    );

    new Setting(containerEl).setName(s.sStats).setDesc(s.sStatsDesc).setHeading();
    const names = Object.entries(this.plugin.devices).map(([id, section]) => {
      const name = section.name || id.slice(0, 8);
      return id === this.plugin.deviceId ? s.thisDevice(name) : name;
    });
    containerEl.createEl("p", { cls: "setting-item-description", text: s.sStatsDevices(names) });
    const now = Date.now();
    const usage = this.plugin.mergedUsage;
    const ranked = rankUsage(usage, now);
    if (!ranked.length) {
      containerEl.createEl("p", { cls: "setting-item-description", text: s.sStatsEmpty });
    }
    for (const r of ranked) {
      const entry = usage[r.path];
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
  RecentFolderMoveSettingTab,
  parentPath,
  isSameOrInside,
  joinPath,
  linesToList,
  scoreOf,
  recordUse,
  mergeEntries,
  rankUsage,
  usageFromRecentList,
  sanitizeDevices,
  mergeDevices,
};
