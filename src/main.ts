import "@material/web/button/filled-button.js";
import "@material/web/button/text-button.js";
import "@material/web/button/outlined-button.js";
import "@material/web/iconbutton/icon-button.js";
import "@material/web/icon/icon.js";
import "@material/web/textfield/outlined-text-field.js";
import "@material/web/switch/switch.js";
import "@material/web/dialog/dialog.js";
import "@material/web/fab/fab.js";
import "@fontsource/material-symbols-rounded/400.css";
import "@fontsource/roboto-serif/400.css";
import "@fontsource/roboto-serif/500.css";
import "./styles.css";

import { derivePassword } from "./derive";
import { applyRoles, DARK, LIGHT, schemeFromSeed } from "./theme";
import * as db from "./db";
import type { Account, Settings, VaultEntry } from "./db";

/* ------------------------------------------------------------------ */
/* dom helpers                                                         */
/* ------------------------------------------------------------------ */

type Props = Record<string, unknown>;
type Child = Node | string | null | undefined | false;

function h(tag: string, props: Props = {}, ...children: Child[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") el.className = String(value);
    else if (key === "text") el.textContent = String(value);
    else if (key.startsWith("on") && typeof value === "function") {
      el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else el.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return el;
}

const icon = (name: string, slot?: string): HTMLElement => h("md-icon", slot ? { slot } : {}, name);

interface Field extends HTMLElement {
  value: string;
  focus(): void;
}
interface Toggle extends HTMLElement {
  selected: boolean;
}
interface DialogEl extends HTMLElement {
  show(): void;
  close(): Promise<void> | void;
}

const field = (label: string, opts: { type?: string; value?: string; placeholder?: string } = {}): HTMLElement =>
  h("md-outlined-text-field", {
    label,
    type: opts.type ?? "text",
    value: opts.value,
    placeholder: opts.placeholder,
  });

const val = (el: HTMLElement): string => (el as unknown as Field).value ?? "";
const setVal = (el: HTMLElement, v: string): void => {
  (el as unknown as Field).value = v;
};

/* ------------------------------------------------------------------ */
/* state                                                               */
/* ------------------------------------------------------------------ */

const root = document.getElementById("app") as HTMLElement;
root.classList.add("app");

let settings: Settings;
let accounts: Account[] = [];
let entries: VaultEntry[] = [];
let activeAccountId: string | null = null;
let search = "";
let listHost: HTMLElement | null = null;

const account = (): Account | undefined => accounts.find((a) => a.id === activeAccountId);

async function saveSettings(patch: Partial<Settings>): Promise<void> {
  settings = { ...settings, ...patch };
  await db.putSettings(settings);
  paintTheme();
}

/* ------------------------------------------------------------------ */
/* theme                                                               */
/* ------------------------------------------------------------------ */

const prefersDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;
const isDark = () => settings.mode === "dark" || (settings.mode === "system" && prefersDark());

function paintTheme(): void {
  const dark = isDark();
  applyRoles(settings.accent ? schemeFromSeed(settings.accent, dark) : dark ? DARK : LIGHT);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#141317" : "#FEF7FF");
}

const THEME_LABEL: Record<Settings["mode"], string> = {
  system: "跟随系统",
  light: "浅色",
  dark: "深色",
};

/* ------------------------------------------------------------------ */
/* snackbar + dialogs                                                  */
/* ------------------------------------------------------------------ */

let snackEl: HTMLElement | null = null;
let snackTimer = 0;

function snackbar(text: string, action?: { label: string; run: () => void }): void {
  snackEl?.remove();
  window.clearTimeout(snackTimer);
  const el = h("div", { class: "snackbar", role: "status" }, h("span", {}, text));
  if (action) {
    const btn = h("md-text-button", {}, action.label);
    btn.style.color = "var(--md-sys-color-inverse-primary)";
    btn.addEventListener("click", () => {
      action.run();
      el.classList.add("is-out");
      window.setTimeout(() => el.remove(), 200);
    });
    el.append(btn);
  }
  document.body.append(el);
  snackEl = el;
  snackTimer = window.setTimeout(() => {
    el.classList.add("is-out");
    window.setTimeout(() => el.remove(), 200);
  }, 3200);
}

function openDialog(title: string, body: HTMLElement, actions: HTMLElement[] = []): DialogEl {
  const dialog = h("md-dialog", {}, h("div", { slot: "headline" }, title), body, h("div", { slot: "actions" }, ...actions));
  document.body.append(dialog);
  const el = dialog as unknown as DialogEl;
  el.show();
  el.addEventListener("closed", () => window.setTimeout(() => dialog.remove(), 200));
  return el;
}

function closeDialog(dialog: DialogEl): void {
  void dialog.close();
}

function confirmAction(title: string, message: string, okLabel: string, danger = false): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const cancel = h("md-text-button", {}, "取消");
    const ok = h("md-text-button", {}, okLabel);
    if (danger) ok.style.color = "var(--md-sys-color-error)";
    const dialog = openDialog(title, h("div", { class: "dlg-body" }, h("p", {}, message)), [cancel, ok]);
    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      closeDialog(dialog);
      resolve(result);
    };
    cancel.addEventListener("click", () => finish(false));
    ok.addEventListener("click", () => finish(true));
    dialog.addEventListener("closed", () => finish(false));
  });
}

/* ------------------------------------------------------------------ */
/* clipboard                                                           */
/* ------------------------------------------------------------------ */

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    snackbar("已复制到剪贴板");
    return;
  } catch {
    const ta = h("textarea") as HTMLTextAreaElement;
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.append(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    snackbar("已复制到剪贴板");
  }
}

/* ------------------------------------------------------------------ */
/* screens                                                             */
/* ------------------------------------------------------------------ */

function swap(next: HTMLElement): void {
  const prev = root.querySelector(".screen.is-active");
  if (prev) {
    prev.classList.remove("is-active");
    prev.classList.add("is-leaving");
    window.setTimeout(() => prev.remove(), 220);
  }
  next.classList.add("screen", "is-active");
  root.append(next);
}

function brandMark(size: "lg" | "sm"): HTMLElement {
  const cls = size === "lg" ? "brand-mark" : "mark-sm";
  return h("div", { class: cls }, icon("key"));
}

/* ------------------------------------------------------------------ */
/* lock screen                                                         */
/* ------------------------------------------------------------------ */

function renderLock(): void {
  activeAccountId = null;
  listHost = null;
  const pw = field("主密码", { type: "password", placeholder: "解锁这台设备上的密码本" });
  const remember = h("md-switch", settings.rememberDefault ? { selected: "" } : {}) as unknown as Toggle;
  const chipsHost = h("div", { class: "chips" });
  let picked: string | null =
    (settings.defaultAccountId && accounts.some((a) => a.id === settings.defaultAccountId) ? settings.defaultAccountId : null) ??
    (accounts[0]?.id ?? null);

  const submit = async (): Promise<void> => {
    const target = accounts.find((a) => a.id === picked);
    if (!target) {
      promptNewAccount(false);
      return;
    }
    if (val(pw) !== target.password) {
      snackbar("主密码不匹配");
      pw.setAttribute("error", "");
      (pw as unknown as Field).focus();
      return;
    }
    pw.removeAttribute("error");
    activeAccountId = target.id;
    await saveSettings({
      activeAccountId: target.id,
      rememberDefault: remember.selected,
      defaultAccountId: remember.selected ? target.id : settings.defaultAccountId,
    });
    renderVault();
  };

  const paintChips = (): void => {
    chipsHost.replaceChildren();
    if (!accounts.length) {
      chipsHost.append(h("p", { class: "hint" }, "这台设备还没有账号。先建一个，之后用它派生所有密码。"));
      return;
    }
    for (const a of accounts) {
      const chip = h("button", { class: "chip", type: "button", "aria-pressed": String(a.id === picked) }, a.name);
      chip.addEventListener("click", () => {
        picked = a.id;
        paintChips();
        (pw as unknown as Field).focus();
      });
      chipsHost.append(chip);
    }
    chipsHost.append(
      h(
        "button",
        {
          class: "chip chip-add",
          type: "button",
          onClick: () => promptNewAccount(false),
        },
        "+ 新账号",
      ),
    );
  };
  paintChips();

  const unlock = h("md-filled-button", {}, "解锁");
  unlock.addEventListener("click", () => void submit());
  pw.addEventListener("keydown", (ev) => {
    const e = ev as KeyboardEvent;
    if (e.key === "Enter") {
      e.preventDefault();
      void submit();
    }
  });

  const card = h(
    "div",
    { class: "card lock-card" },
    h("div", { class: "field-label" }, accounts.length ? "选择账号" : "账号"),
    chipsHost,
    pw,
    h("label", { class: "switch-row" }, remember, h("span", {}, "记住登录，下次直接进入")),
    h("div", { class: "lock-actions" }, unlock, h("md-text-button", { onClick: () => promptNewAccount(false) }, "新建账号")),
  );

  const screen = h(
    "section",
    { class: "screen" },
    h("div", { class: "lock" }, h("div", { class: "lock-glow" })),
  );
  const lockBody = screen.querySelector(".lock") as HTMLElement;
  lockBody.append(
    h(
      "header",
      { class: "brand" },
      brandMark("lg"),
      h("h1", { class: "brand-name" }, "PassWordCreaterManager"),
      h("p", { class: "brand-tag" }, "你只需要记住两件事：账号名和主密码。网站要的那串乱码，由它们算出来。"),
    ),
    card,
    h("p", { class: "foot" }, "全部计算在本机完成，不上传、不同步、不联网。"),
  );

  swap(screen);
  window.setTimeout(() => {
    (pw as unknown as Field).focus();
  }, 260);
}

/* ------------------------------------------------------------------ */
/* new account dialog                                                  */
/* ------------------------------------------------------------------ */

function promptNewAccount(enterAfter: boolean): void {
  const nameF = field("账号名称", { placeholder: "例如 allpay" });
  const pwF = field("主密码", { type: "password", placeholder: "至少 8 位" });
  const pw2F = field("再输一次", { type: "password" });
  const create = h("md-filled-button", {}, "创建");
  const cancel = h("md-text-button", {}, "取消");
  const body = h(
    "div",
    { class: "dlg-body" },
    h("p", {}, "账号名和主密码一起决定所有派生结果。定下来就别再改——改名等于换一套密码。"),
    nameF,
    pwF,
    pw2F,
  );
  const dialog = openDialog("新建账号", body, [cancel, create]);
  cancel.addEventListener("click", () => closeDialog(dialog));

  create.addEventListener("click", () => {
    void (async () => {
      const name = val(nameF).trim();
      const pw1 = val(pwF);
      if (!name) return snackbar("账号名不能为空");
      if (accounts.some((a) => a.name.toLowerCase() === name.toLowerCase())) return snackbar("这个账号名已经存在");
      if (pw1.length < 8) return snackbar("主密码至少 8 位");
      if (pw1 !== val(pw2F)) return snackbar("两次输入不一致");
      const created = await db.createAccount(name, pw1);
      accounts = await db.listAccounts();
      closeDialog(dialog);
      if (enterAfter) {
        activeAccountId = created.id;
        await saveSettings({ activeAccountId: created.id, defaultAccountId: settings.rememberDefault ? created.id : settings.defaultAccountId });
        renderVault();
      } else {
        renderLock();
        snackbar("账号已创建，输入主密码解锁");
      }
    })();
  });
}

/* ------------------------------------------------------------------ */
/* vault screen                                                        */
/* ------------------------------------------------------------------ */

function renderVault(): void {
  const acc = account();
  if (!acc) {
    renderLock();
    return;
  }

  const searchF = field("搜索", { type: "search", placeholder: "备注或站点" });
  searchF.addEventListener("input", () => {
    search = val(searchF);
    renderList();
  });

  const themeBtn = h("md-icon-button", { "aria-label": "切换主题" }, icon(isDark() ? "light_mode" : "dark_mode"));
  themeBtn.addEventListener("click", () => {
    const order: Array<Settings["mode"]> = ["system", "light", "dark"];
    const next = order[(order.indexOf(settings.mode) + 1) % order.length];
    void saveSettings({ mode: next }).then(() => {
      snackbar("主题：" + THEME_LABEL[next]);
      renderVault();
    });
  });

  const menuBtn = h("md-icon-button", { "aria-label": "菜单" }, icon("more_vert"));
  menuBtn.addEventListener("click", () => openMenu());

  const bar = h(
    "header",
    { class: "bar" },
    h("div", { class: "bar-brand" }, brandMark("sm"), h("span", {}, "PassWordCreaterManager")),
    h("div", { class: "bar-search" }, searchF),
    h("div", { class: "bar-actions" }, themeBtn, menuBtn),
  );

  const switchBtn = h("md-text-button", { onClick: () => openAccountManager() }, "切换账号");
  const lockBtn = h("md-text-button", {}, "锁定");
  lockBtn.addEventListener("click", () => renderLock());

  const accountbar = h("div", { class: "accountbar" }, h("span", { class: "acct-name" }, "当前账号 " + acc.name), switchBtn, lockBtn);

  const list = h("main", { class: "list" });
  listHost = list;

  const fab = h("md-fab", { class: "fab-wrap", variant: "primary", label: "新建条目" }, icon("add", "icon"));
  fab.addEventListener("click", () => void addEntry());

  const screen = h("section", { class: "screen" }, bar, accountbar, list, fab);
  swap(screen);
  renderList();
}

function renderList(): void {
  const host = listHost;
  const acc = account();
  if (!host || !acc) return;
  host.replaceChildren();
  const q = search.trim().toLowerCase();
  const mine = entries.filter((e) => e.accountId === acc.id);
  const rows = q ? mine.filter((e) => (e.note ?? "").toLowerCase().includes(q) || e.site.toLowerCase().includes(q)) : mine;

  if (!rows.length) {
    host.append(emptyState(mine.length === 0));
    return;
  }
  for (const entry of rows) host.append(entryCard(entry, acc));
}

function emptyState(firstTime: boolean): HTMLElement {
  if (!firstTime) {
    return h("div", { class: "card empty" }, h("h2", {}, "没有匹配的条目"), h("p", { class: "hint" }, "换个关键词试试。"));
  }
  return h(
    "div",
    { class: "card empty" },
    h("h2", {}, "第一步：记一个站点"),
    h(
      "ol",
      { class: "steps" },
      h("li", {}, "点右下角新建条目，填站点和备注，例如 github.com / 代码托管。"),
      h("li", {}, "填你本来会用的简单密码，例如 github-2019。它不会发给任何网站。"),
      h("li", {}, "下方立刻算出强密码，复制到网站注册即可。以后回到这里，同样的输入永远得到同样的结果。"),
    ),
    h("p", { class: "hint" }, "账号名 + 主密码 + 站点 + 简单密码，四样一致时结果才一致。"),
  );
}

/* ------------------------------------------------------------------ */
/* entry card                                                          */
/* ------------------------------------------------------------------ */

function entryCard(e: VaultEntry, acc: Account): HTMLElement {
  let visible = false;
  let derived = "";
  let seq = 0;

  const title = (): string => e.note?.trim() || e.site.trim() || "未命名条目";
  const titleEl = h("span", { class: "entry-title" }, title());
  const subEl = h("span", { class: "entry-sub" }, e.site.trim() || "还没填站点");
  const previewEl = h("span", { class: "entry-pw" }, "••••••••");
  const avatarEl = h("span", { class: "entry-avatar" }, (title()[0] ?? "?").toUpperCase());
  const head = h(
    "button",
    { class: "entry-head", type: "button" },
    avatarEl,
    h("div", { class: "entry-meta" }, titleEl, subEl),
    previewEl,
    icon("expand_more", undefined),
  );
  (head.lastElementChild as HTMLElement).classList.add("entry-chev");

  const noteF = field("备注", { value: e.note ?? "", placeholder: "这个账号是干什么的" });
  const siteF = field("站点或服务", { value: e.site, placeholder: "github.com" });
  const urlF = field("网址", { value: e.url ?? "", placeholder: "https://" });
  const simpleF = field("简单密码", { type: "password", value: e.password, placeholder: "你本来会用的那一串" });
  const counterF = field("序号", { type: "number", value: String(e.counter) });

  const pwValue = h("span", { class: "pw-value" }, "……");
  const pwBox = h("div", { class: "pw-box is-veiled" }, pwValue);
  const revealBtn = h("md-icon-button", { "aria-label": "显示或隐藏密码" }, icon("visibility"));
  const copyBtn = h("md-icon-button", { "aria-label": "复制密码" }, icon("content_copy"));
  pwBox.append(revealBtn, copyBtn);

  const lenInput = h("input", { type: "range", min: "8", max: "64", step: "1", value: String(e.length) }) as HTMLInputElement;
  const lenOut = h("span", { class: "tune-num" }, String(e.length));
  const symSwitch = h("md-switch", e.symbols ? { selected: "" } : {}) as unknown as Toggle;

  const recompute = async (): Promise<void> => {
    const mine = ++seq;
    if (!e.site.trim()) {
      pwValue.textContent = "先填站点";
      pwBox.classList.add("is-veiled");
      derived = "";
      return;
    }
    pwValue.textContent = "计算中…";
    const password = await derivePassword({
      appName: acc.name,
      appPassword: acc.password,
      site: e.site,
      simple: e.password,
      length: e.length,
      counter: e.counter,
      symbols: e.symbols,
    });
    if (mine !== seq) return;
    derived = password;
    pwValue.textContent = visible ? password : "•".repeat(Math.min(password.length, 20));
    pwBox.classList.toggle("is-veiled", !visible);
    previewEl.textContent = "•".repeat(Math.min(password.length, 12));
  };

  let saveTimer = 0;
  const persist = (): void => {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      void (async () => {
        e.updatedAt = Date.now();
        await db.putEntry({ ...e });
        titleEl.textContent = title();
        subEl.textContent = e.site.trim() || "还没填站点";
        avatarEl.textContent = (title()[0] ?? "?").toUpperCase();
        void recompute();
      })();
    }, 240);
  };

  noteF.addEventListener("input", () => {
    e.note = val(noteF);
    persist();
  });
  siteF.addEventListener("input", () => {
    e.site = val(siteF);
    persist();
  });
  urlF.addEventListener("input", () => {
    e.url = val(urlF);
    persist();
  });
  simpleF.addEventListener("input", () => {
    e.password = val(simpleF);
    persist();
  });
  counterF.addEventListener("input", () => {
    const n = Number.parseInt(val(counterF), 10);
    e.counter = Number.isFinite(n) && n > 0 ? n : 1;
    persist();
  });
  lenInput.addEventListener("input", () => {
    e.length = Number.parseInt(lenInput.value, 10);
    lenOut.textContent = String(e.length);
    persist();
  });
  symSwitch.addEventListener("change", () => {
    e.symbols = symSwitch.selected;
    persist();
  });
  revealBtn.addEventListener("click", () => {
    visible = !visible;
    if (!derived) void recompute();
    else {
      pwValue.textContent = visible ? derived : "•".repeat(Math.min(derived.length, 20));
      pwBox.classList.toggle("is-veiled", !visible);
    }
    revealBtn.querySelector("md-icon")?.replaceChildren(document.createTextNode(visible ? "visibility_off" : "visibility"));
  });
  copyBtn.addEventListener("click", () => {
    void (async () => {
      if (!derived) await recompute();
      if (!derived) return snackbar("先填站点再复制");
      await copyText(derived);
    })();
  });

  const openBtn = h("md-text-button", {}, "打开站点");
  openBtn.addEventListener("click", () => {
    const raw = (e.url ?? "").trim() || e.site.trim();
    if (!raw) return snackbar("先填网址或站点");
    const url = /^https?:\/\//i.test(raw) ? raw : "https://" + raw;
    window.open(url, "_blank", "noopener");
  });

  const delBtn = h("md-text-button", {}, "删除");
  delBtn.style.color = "var(--md-sys-color-error)";
  delBtn.addEventListener("click", () => {
    void (async () => {
      const ok = await confirmAction("删除条目", "「" + title() + "」会从这台设备移除，且无法恢复。", "删除", true);
      if (!ok) return;
      await db.removeEntry(e.id);
      entries = await db.listEntries();
      renderList();
      snackbar("已删除");
    })();
  });

  const body = h(
    "div",
    { class: "entry-body" },
    h("div", { class: "entry-fields" }, noteF, siteF, urlF, simpleF),
    pwBox,
    h("div", { class: "tune" }, lenInput, lenOut),
    h("div", { class: "switch-row" }, symSwitch, h("span", {}, "包含符号")),
    h("div", { class: "entry-fields is-narrow" }, counterF),
    h("div", { class: "entry-actions" }, openBtn, h("span", { class: "spacer" }), delBtn),
  );
  body.hidden = true;

  head.addEventListener("click", () => {
    const opening = body.hidden;
    body.hidden = !opening;
    head.parentElement?.classList.toggle("is-open", opening);
    head.setAttribute("aria-expanded", String(opening));
    if (opening) void recompute();
  });

  const card = h("article", { class: "entry" }, head, body);
  return card;
}

/* ------------------------------------------------------------------ */
/* entries                                                             */
/* ------------------------------------------------------------------ */

async function addEntry(): Promise<void> {
  const acc = account();
  if (!acc) return;
  const now = Date.now();
  const entry: VaultEntry = {
    id: db.newId(),
    accountId: acc.id,
    note: "",
    site: "",
    url: "",
    password: "",
    length: 20,
    counter: 1,
    symbols: true,
    createdAt: now,
    updatedAt: now,
  };
  await db.putEntry(entry);
  entries = await db.listEntries();
  search = "";
  renderList();
  const first = listHost?.firstElementChild as HTMLElement | null;
  if (first) {
    (first.querySelector(".entry-head") as HTMLElement | null)?.click();
    first.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
}

/* ------------------------------------------------------------------ */
/* account manager                                                     */
/* ------------------------------------------------------------------ */

function openAccountManager(): void {
  const body = h("div", { class: "dlg-body" });
  const rows = h("div", { class: "menu-list" });
  const render = (): void => {
    rows.replaceChildren();
    for (const a of accounts) {
      const count = entries.filter((e) => e.accountId === a.id).length;
      const use = h("md-text-button", {}, a.id === activeAccountId ? "当前" : "切换");
      if (a.id === activeAccountId) use.setAttribute("disabled", "");
      const del = h("md-icon-button", { "aria-label": "删除账号" }, icon("delete"));
      use.addEventListener("click", () => {
        activeAccountId = a.id;
        void saveSettings({ activeAccountId: a.id }).then(() => {
          renderVault();
          snackbar("已切换到 " + a.name);
        });
      });
      del.addEventListener("click", () => {
        void (async () => {
          const ok = await confirmAction(
            "删除账号",
            "账号「" + a.name + "」和它的 " + count + " 条密码记录都会被删除。派生密码本身不受影响，只要你还记得账号名和主密码。",
            "删除",
            true,
          );
          if (!ok) return;
          await db.deleteAccount(a.id);
          accounts = await db.listAccounts();
          entries = await db.listEntries();
          if (activeAccountId === a.id) activeAccountId = accounts[0]?.id ?? null;
          await saveSettings({ activeAccountId });
          render();
          if (activeAccountId) renderVault();
          else renderLock();
        })();
      });
      rows.append(h("div", { class: "acct-row" }, h("span", { class: "acct-row-name" }, a.name), h("span", { class: "acct-row-sub" }, count + " 条"), use, del));
    }
  };
  render();
  body.append(rows, h("md-text-button", { onClick: () => promptNewAccount(true) }, "新建账号"));
  openDialog("账号管理", body);
}

/* ------------------------------------------------------------------ */
/* backup                                                              */
/* ------------------------------------------------------------------ */

const BACKUP_FORMAT = "password-creater-manager-backup";

interface HostBridge {
  chrome?: { webview?: { postMessage(message: string): void } };
  pvb?: { saveBackup(name: string, content: string): void };
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return "" + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes());
}

function backupPayload(): string {
  const byId = new Map(accounts.map((a) => [a.id, a.name]));
  return JSON.stringify(
    {
      format: BACKUP_FORMAT,
      version: 1,
      exportedAt: new Date().toISOString(),
      accounts: accounts.map((a) => ({ name: a.name, password: a.password, createdAt: a.createdAt })),
      entries: entries.map((e) => ({
        accountName: byId.get(e.accountId) ?? "",
        note: e.note ?? "",
        site: e.site,
        url: e.url ?? "",
        password: e.password,
        length: e.length,
        counter: e.counter,
        symbols: e.symbols,
      })),
    },
    null,
    2,
  );
}

function exportBackup(): void {
  if (!accounts.length) return snackbar("还没有可导出的数据");
  const name = "PassWordCreaterManager-backup-" + stamp() + ".json";
  const text = backupPayload();
  const host = window as unknown as HostBridge;
  if (host.chrome?.webview) {
    host.chrome.webview.postMessage("SAVE:" + name + "\n" + text);
    snackbar("已保存 " + name);
    return;
  }
  if (host.pvb) {
    host.pvb.saveBackup(name, text);
    snackbar("已保存 " + name);
    return;
  }
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = h("a", { href: url, download: name }) as HTMLAnchorElement;
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
  snackbar("已保存 " + name);
}

interface RawBackup {
  format?: string;
  accounts?: Array<{ name?: string; password?: string; createdAt?: number }>;
  entries?: Array<{
    accountName?: string;
    note?: string;
    site?: string;
    url?: string;
    password?: string;
    length?: number;
    counter?: number;
    symbols?: boolean;
  }>;
}

async function applyBackupText(text: string): Promise<void> {
  let raw: RawBackup;
  try {
    raw = JSON.parse(text) as RawBackup;
  } catch {
    return snackbar("这不是有效的 JSON 备份");
  }
  if (raw.format !== BACKUP_FORMAT && raw.format !== "pwvault-backup") return snackbar("备份格式不匹配");
  let addedAccounts = 0;
  let addedEntries = 0;
  const nameToId = new Map<string, string>();
  for (const a of accounts) nameToId.set(a.name.toLowerCase(), a.id);

  for (const item of raw.accounts ?? []) {
    const name = (item.name ?? "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (nameToId.has(key)) continue;
    const created = await db.createAccount(name, item.password ?? "");
    nameToId.set(key, created.id);
    addedAccounts += 1;
  }
  accounts = await db.listAccounts();
  for (const a of accounts) nameToId.set(a.name.toLowerCase(), a.id);

  const seen = new Set(entries.map((e) => [e.accountId, e.site, e.password].join("|")));
  const now = Date.now();
  for (const item of raw.entries ?? []) {
    const accountName = (item.accountName ?? "").trim().toLowerCase();
    const accountId = nameToId.get(accountName);
    if (!accountId) continue;
    const site = (item.site ?? "").trim();
    const simple = item.password ?? "";
    if (!site) continue;
    const key = [accountId, site, simple].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    await db.putEntry({
      id: db.newId(),
      accountId,
      note: item.note ?? "",
      site,
      url: item.url ?? "",
      password: simple,
      length: Math.min(Math.max(item.length ?? 20, 8), 64),
      counter: item.counter ?? 1,
      symbols: item.symbols !== false,
      createdAt: now,
      updatedAt: now,
    });
    addedEntries += 1;
  }
  entries = await db.listEntries();
  renderList();
  snackbar("导入完成：账号 +" + addedAccounts + "，条目 +" + addedEntries);
}

function importFromFile(): void {
  const input = h("input", { type: "file", accept: "application/json,.json" }) as HTMLInputElement;
  input.style.display = "none";
  document.body.append(input);
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (!file) return;
    void file.text().then((text) => applyBackupText(text));
    input.remove();
  });
  input.click();
}

function importFromPaste(): void {
  const area = h("md-outlined-text-field", { type: "textarea", rows: "6", label: "备份 JSON" });
  const body = h("div", { class: "dlg-body" }, h("p", {}, "把备份文件的内容粘贴到这里。"), area);
  const ok = h("md-filled-button", {}, "导入");
  const cancel = h("md-text-button", {}, "取消");
  const dialog = openDialog("粘贴导入", body, [cancel, ok]);
  cancel.addEventListener("click", () => closeDialog(dialog));
  ok.addEventListener("click", () => {
    const text = val(area);
    if (!text.trim()) return snackbar("先粘贴内容");
    closeDialog(dialog);
    void applyBackupText(text);
  });
}

/* ------------------------------------------------------------------ */
/* about + wipe                                                        */
/* ------------------------------------------------------------------ */

function openAbout(): void {
  const body = h(
    "div",
    { class: "dlg-body" },
    h("p", {}, "PassWordCreaterManager 把「账号名 + 主密码」当作种子，配合站点名和你记得住的简单密码，用 PBKDF2-HMAC-SHA256（10 万次迭代）算出强密码。"),
    h("p", {}, "因为是算出来的而不是存出来的，备份里没有真正要用的那串密码；只要账号名、主密码、站点、简单密码四样一致，换设备也能得到同样的结果。"),
    h("p", {}, "派生参数与上一代保持一致，所以已经注册的密码不会改变。账号名参与计算，改账号名等于换一套密码。"),
    h("p", {}, "本项目由 AI 生成后开源，发布前经过人工检查。请自行阅读源码后再决定是否信任。"),
  );
  openDialog("关于", body);
}

async function wipeAll(): Promise<void> {
  const ok = await confirmAction(
    "清空所有本地数据",
    "所有账号、条目和设置都会从这台设备删除。派生规则还在，记得账号名和主密码就能重新算回密码。",
    "全部删除",
    true,
  );
  if (!ok) return;
  await db.wipeDatabase();
  window.location.reload();
}

function openMenu(): void {
  const items: Array<{ icon: string; label: string; run: () => void; danger?: boolean }> = [
    { icon: "add", label: "新建条目", run: () => void addEntry() },
    { icon: "person_add", label: "新建账号", run: () => promptNewAccount(true) },
    { icon: "manage_accounts", label: "账号管理", run: () => openAccountManager() },
    { icon: "save", label: "保存备份", run: () => exportBackup() },
    { icon: "upload_file", label: "从文件导入", run: () => importFromFile() },
    { icon: "content_paste", label: "粘贴导入", run: () => importFromPaste() },
    {
      icon: isDark() ? "light_mode" : "dark_mode",
      label: "主题：" + THEME_LABEL[settings.mode],
      run: () => {
        const order: Array<Settings["mode"]> = ["system", "light", "dark"];
        void saveSettings({ mode: order[(order.indexOf(settings.mode) + 1) % order.length] }).then(() => renderVault());
      },
    },
    { icon: "info", label: "关于", run: () => openAbout() },
    { icon: "delete_forever", label: "清空所有本地数据", run: () => void wipeAll(), danger: true },
  ];
  const body = h("div", { class: "dlg-body" }, h("div", { class: "menu-list" }));
  const listEl = body.firstElementChild as HTMLElement;
  const dialog = openDialog("菜单", body);
  for (const item of items) {
    const row = h(
      "button",
      { class: "menu-item" + (item.danger ? " is-danger" : ""), type: "button" },
      icon(item.icon),
      h("span", {}, item.label),
    );
    row.addEventListener("click", () => {
      closeDialog(dialog);
      window.setTimeout(() => item.run(), 180);
    });
    listEl.append(row);
  }
}

/* ------------------------------------------------------------------ */
/* host bridge                                                         */
/* ------------------------------------------------------------------ */

function hookHostMessages(): void {
  const host = window as unknown as HostBridge & { chrome?: { webview?: { addEventListener(t: string, f: (e: { data: string }) => void): void } } };
  host.chrome?.webview?.addEventListener("message", (ev) => {
    const data = String(ev.data ?? "");
    if (data.startsWith("SAVED:")) snackbar("已保存到 " + data.slice(6));
    else if (data.startsWith("ERR:")) snackbar("保存失败：" + data.slice(4));
  });
}

/* ------------------------------------------------------------------ */
/* boot                                                                */
/* ------------------------------------------------------------------ */

async function boot(): Promise<void> {
  settings = await db.getSettings();
  accounts = await db.listAccounts();
  entries = await db.listEntries();
  paintTheme();
  hookHostMessages();
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (settings.mode === "system") paintTheme();
  });

  const remembered = settings.rememberDefault ? accounts.find((a) => a.id === settings.defaultAccountId) : undefined;
  if (remembered) {
    activeAccountId = remembered.id;
    renderVault();
  } else {
    renderLock();
  }

  window.addEventListener("keydown", (ev) => {
    const e = ev as KeyboardEvent;
    const meta = e.ctrlKey || e.metaKey;
    if (meta && e.key.toLowerCase() === "k") {
      e.preventDefault();
      const searchEl = document.querySelector(".bar-search md-outlined-text-field") as HTMLElement | null;
      (searchEl as unknown as Field | null)?.focus();
    }
    if (meta && e.key.toLowerCase() === "n" && activeAccountId) {
      e.preventDefault();
      void addEntry();
    }
  });
}

void boot();
