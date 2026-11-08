// ==UserScript==
// @name         Janitor Ai Chat Tweaks
// @namespace    https://github.com/ajrc0re/JanitorAiChatTweaks
// @version      1.7.0
// @description  Improves the JanitorAI Chat Interface
// @match        https://janitorai.com/*
// @run-at       document-start
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @homepageURL  https://github.com/ajrc0re/JanitorAiChatTweaks
// @supportURL   https://github.com/ajrc0re/JanitorAiChatTweaks/issues
// @updateURL    https://raw.githubusercontent.com/ajrc0re/JanitorAiChatTweaks/main/JAI-Chat-Tweaks.user.js
// @downloadURL  https://raw.githubusercontent.com/ajrc0re/JanitorAiChatTweaks/main/JAI-Chat-Tweaks.user.js
// ==/UserScript==

(() => {
  /******************************************************************
   * SETTINGS
   *
   * Don't edit these here. Open the settings panel instead: the gear
   * button in the chat's bottom bar, or the Tampermonkey menu ->
   * "Chat Tweaks settings". Your choices are saved by the userscript
   * manager (GM_setValue), so updating the script no longer clashes with
   * your changes. These are only the defaults for anything you haven't set.
   ******************************************************************/
  const DEFAULTS = {
    // Chat bubbles: "separated" | "joined" | "none"
    bubbles: "joined",
    // Alternating alignment: "off" | "userRight" | "botRight" | "bothRight"
    alternating: "userRight",
    // Chat width percent (0 = default site width)
    chatWidthPct: 85,
    // Bubble colors (RGBA strings)
    userBubble: "rgba(24, 24, 24, 0.80)",
    botBubble: "rgba(26, 27, 22, 0.80)",
    // If true: botBubble is auto-darkened from userBubble by botDarkenPct (0..100)
    darkenBotFromUser: false,
    botDarkenPct: 20,
    // Completely remove the SoundCloud music player under the chat title
    hideMusicPlayer: false,
    // Hide the chat header until you hover the top edge of the screen
    autoHideHeader: false,
    // With autoHideHeader: keep these visible in their usual spot
    alwaysShowProxyIcon: false,
    alwaysShowMenuIcon: false,
    // Story notes stripper (eraser button): the tracker line to remove
    // (a regular expression, used with the g, i and m flags) and how many of
    // the newest bot replies keep theirs.
    trackerRegex: String.raw`\s*^[ \t]*~~~[ \t]*(?:json)?[ \t]*\{.*\}[ \t]*$`,
    keepTrackerCount: 3,
  };

  const SETTINGS_KEY = "settings";

  // GM storage when the manager provides it, localStorage otherwise.
  function storageGet() {
    try {
      if (typeof GM_getValue === "function") {
        const v = GM_getValue(SETTINGS_KEY, null);
        return typeof v === "string" ? JSON.parse(v) : v;
      }
    } catch (e) { /* fall through */ }
    try { return JSON.parse(localStorage.getItem("jct-" + SETTINGS_KEY) || "null"); } catch (e) { return null; }
  }
  function storageSet(obj) {
    const json = JSON.stringify(obj);
    try {
      if (typeof GM_setValue === "function") { GM_setValue(SETTINGS_KEY, json); return; }
    } catch (e) { /* fall through */ }
    try { localStorage.setItem("jct-" + SETTINGS_KEY, json); } catch (e) { /* ignore */ }
  }

  // Only keep known keys whose type matches the default.
  function sanitize(obj) {
    const out = {};
    if (!obj || typeof obj !== "object") return out;
    for (const k of Object.keys(DEFAULTS)) {
      if (k in obj && typeof obj[k] === typeof DEFAULTS[k]) out[k] = obj[k];
    }
    return out;
  }

  // Saved values only differ from defaults where you changed something, so
  // a default improved in a later version still reaches you.
  function loadSettings() {
    return Object.assign({}, DEFAULTS, sanitize(storageGet()));
  }
  // "rgba(1,2,3,0.80)" and "rgba(1, 2, 3, 0.8)" count as the same color.
  function sameSetting(a, b) {
    if (a === b) return true;
    if (typeof a !== "string" || typeof b !== "string") return false;
    const ca = parseRgba(a), cb = parseRgba(b);
    return !!ca && !!cb && toRgba(ca) === toRgba(cb);
  }
  function saveSettings(next) {
    const diff = {};
    for (const k of Object.keys(DEFAULTS)) {
      if (!sameSetting(next[k], DEFAULTS[k])) diff[k] = next[k];
    }
    storageSet(diff);
  }

  let cfg = loadSettings();

  /******************************************************************
   * Small color helper (optional, only used if darkenBotFromUser=true)
   ******************************************************************/
  function clamp(n, min, max) { return Math.min(max, Math.max(min, n)); }
  function parseRgba(str) {
    const m = str.replace(/\s+/g, "").match(/^rgba?\((\d+),(\d+),(\d+)(?:,([0-9.]+))?\)$/i);
    if (!m) return null;
    return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
  }
  function toRgba(c) { return `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${clamp(c.a,0,1)})`; }
  function darken(c, pct) {
    const p = clamp(pct / 100, 0, 1);
    return { r: c.r * (1 - p), g: c.g * (1 - p), b: c.b * (1 - p), a: c.a };
  }

  function bubbleColors() {
    let bot = cfg.botBubble;
    if (cfg.darkenBotFromUser) {
      const parsed = parseRgba(cfg.userBubble);
      if (parsed) bot = toRgba(darken(parsed, cfg.botDarkenPct));
    }
    return { user: cfg.userBubble, bot };
  }

  /******************************************************************
   * Message tagging
   *
   * The site's DOM gives no stable way to tell user messages from bot
   * messages, and some browsers (notably Safari) don't re-evaluate CSS
   * :has() rules when React inserts new messages. So instead of relying
   * on :has(), we tag each message with our own classes from JS and keep
   * them up to date with a MutationObserver as messages are added,
   * swiped, edited or re-rendered.
   *
   *   wrapper  ([class*="messageDisplayWrapper"]) -> jct-msg + jct-user | jct-bot
   *   body     ([class*="messageBody"])           -> jct-editing while a textarea is open
   *   content  (2nd child of messageBody)        -> jct-bubble (when not editing)
   ******************************************************************/
  const BODY_SEL = '[class*="messageBody"]';

  function setClass(el, cls, on) {
    if (el && el.classList.contains(cls) !== on) el.classList.toggle(cls, on);
  }

  function tagMessage(body) {
    const nameContainer = body.querySelector('[class*="nameContainer"]');
    // User messages have just the name; bot messages also carry the character icon.
    const isUser = !!nameContainer && nameContainer.children.length === 1;
    const editing = !!body.querySelector("textarea");
    const content = body.children[1] || null;
    const wrapper = body.closest('[class*="messageDisplayWrapper"]');

    if (wrapper) {
      setClass(wrapper, "jct-msg", true);
      setClass(wrapper, "jct-user", isUser);
      setClass(wrapper, "jct-bot", !isUser);
    }
    setClass(body, "jct-editing", editing);

    // Drop a stale bubble tag if the content element was swapped out.
    for (const child of body.children) {
      if (child !== content) setClass(child, "jct-bubble", false);
    }
    if (content) setClass(content, "jct-bubble", !editing && content.tagName !== "TEXTAREA");
  }

  // Stop the music player's iframe from loading at all, not just hide it.
  function killMusicPlayer() {
    document.querySelectorAll('[class*="soundcloudPlayer"] iframe').forEach((f) => {
      if (f.getAttribute("src") !== "about:blank") f.setAttribute("src", "about:blank");
    });
  }

  // How far the auto-hidden header is slid up, so icons kept visible can be
  // slid back down by the same amount and stay where they normally sit.
  function keepHeaderIcons() {
    return cfg.autoHideHeader && (cfg.alwaysShowProxyIcon || cfg.alwaysShowMenuIcon);
  }
  function updateHeaderShift() {
    const header = document.querySelector('[data-chat-header="true"]');
    if (!header) return;
    const shift = Math.max(0, header.offsetHeight - 12) + "px";
    if (header.style.getPropertyValue("--jct-header-shift") !== shift) {
      header.style.setProperty("--jct-header-shift", shift);
    }
  }

  function tagAll() {
    document.querySelectorAll(BODY_SEL).forEach(tagMessage);
    if (cfg.hideMusicPlayer) killMusicPlayer();
    if (keepHeaderIcons()) updateHeaderShift();
    ensureJumpButton();
    ensureStripButton();
    ensureExportButton();
    ensureSettingsButton();
  }

  let scheduled = false;
  function scheduleTag() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      tagAll();
    });
  }

  function startObserver() {
    tagAll();
    // childList catches new messages, swipes and edit mode; class changes catch
    // React re-renders that overwrite our classes. tagMessage only writes when
    // something actually changed, so this settles after one pass.
    new MutationObserver(scheduleTag).observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class"],
    });
  }


  /******************************************************************
   * Message jump & copy picker
   *
   * Adds a "#" button next to the persona picker in the bottom bar. It
   * opens a flyout with one button per message (1 = the greeting). Picking
   * a number scrolls the chat to that message. Pressing "Copy" first makes
   * the next pick copy that message's raw text (asterisks and all) to the
   * clipboard instead.
   *
   * The chat list is virtualized, so off-screen messages may not exist in
   * the DOM. We read the site's own chat store (through React's internal
   * fiber links) to get every message's text and the list's scrollToIndex
   * function. If the site changes and the store can't be found, we fall
   * back to DOM-only scrolling and copy the rendered text.
   ******************************************************************/
  const JUMP_BTN_ID = "jct-jump-btn";
  const FLYOUT_ID = "jct-jump-flyout";

  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function getScroller() {
    return document.querySelector('[class*="_scroller_"]');
  }

  // Walk up the React fiber tree from the message list to the component
  // that receives the chat store, and return its messagesStore.
  function getChatStore() {
    // Start from a rendered message's list, or from the scroller itself if
    // no message rows are rendered (the store sits a few levels above both).
    const item = document.querySelector("[data-index]");
    const starts = [item && item.parentElement, getScroller()].filter(Boolean);
    for (const start of starts) {
      const key = Object.keys(start).find((k) => k.startsWith("__reactFiber"));
      let f = key && start[key];
      for (let depth = 0; f && depth < 40; depth++, f = f.return) {
        const cs = f.memoizedProps && f.memoizedProps.chatStore;
        const ms = cs && cs.messagesStore;
        if (ms && Array.isArray(ms.messages)) return cs;
      }
    }
    return null;
  }

  function getMessagesStore() {
    const cs = getChatStore();
    return cs ? cs.messagesStore : null;
  }

  // Each entry is a message, or an array of alternatives (swipes on the
  // latest reply). Pick the one currently shown.
  function resolveEntry(store, i) {
    const entry = store.messages[i];
    if (!Array.isArray(entry)) return entry || null;
    const last = i === store.messages.length - 1;
    let pick = last ? store.lastMessageIndex : i === 0 ? store.selectedFirstMessageIndex : -1;
    if (!(pick >= 0 && pick < entry.length)) {
      pick = entry.findIndex((m) => m && m.is_main);
      if (pick < 0) pick = 0;
    }
    return entry[pick] || null;
  }

  // Message list as [{ isBot }], from the store or, failing that, the DOM.
  function listMessages() {
    const store = getMessagesStore();
    if (store) {
      return store.messages.map((_, i) => {
        const m = resolveEntry(store, i);
        return { isBot: !!(m && m.is_bot) };
      });
    }
    const items = [...document.querySelectorAll("[data-index]")];
    const max = items.reduce((n, el) => Math.max(n, +el.dataset.index), -1);
    return Array.from({ length: max + 1 }, (_, i) => {
      const el = document.querySelector(`[data-index="${i}"] .jct-msg`);
      return { isBot: !el || el.classList.contains("jct-bot") };
    });
  }

  // Top edge of the visible chat area (just under the fixed chat header).
  function viewTop() {
    const header = document.querySelector('[data-chat-header="true"]');
    const sc = getScroller();
    const scTop = sc ? sc.getBoundingClientRect().top : 0;
    return Math.max(scTop, header ? header.getBoundingClientRect().bottom : 0) + 8;
  }

  // Index of the message at the top of the screen, to highlight in the grid.
  function currentIndex() {
    const top = viewTop();
    let best = -1;
    for (const el of document.querySelectorAll("[data-index]")) {
      const r = el.getBoundingClientRect();
      if (r.bottom > top && (best < 0 || +el.dataset.index < best)) best = +el.dataset.index;
    }
    return best;
  }

  function renderedRange() {
    const idx = [...document.querySelectorAll("[data-index]")].map((el) => +el.dataset.index);
    return idx.length ? [Math.min(...idx), Math.max(...idx)] : null;
  }

  async function jumpTo(i) {
    const sc = getScroller();
    if (!sc) return false;
    const store = getMessagesStore();
    const list = store && store.messageListRef && store.messageListRef.current;

    if (list && typeof list.scrollToIndex === "function") {
      // The site's own scroll lines the message's bottom up with the screen
      // bottom; it also makes the virtual list render the message.
      list.scrollToIndex(i, "auto");
    }

    // Find the message element, stepping through the list if it isn't
    // rendered yet (only needed when the store isn't available).
    let el = null;
    for (let step = 0; step < 300 && !el; step++) {
      await frame();
      el = sc.querySelector(`[data-index="${i}"]`);
      if (el) break;
      const range = renderedRange();
      if (!range) return false;
      const dir = i < range[0] ? -1 : 1;
      const before = sc.scrollTop;
      sc.scrollTop += dir * sc.clientHeight * 0.8;
      if (sc.scrollTop === before) break;
    }
    if (!el) return false;

    // Put the top of the message just under the header. Repeat a couple of
    // times because the virtual list re-measures rows as they render.
    for (let pass = 0; pass < 3; pass++) {
      await frame();
      el = sc.querySelector(`[data-index="${i}"]`) || el;
      const delta = el.getBoundingClientRect().top - viewTop();
      if (Math.abs(delta) < 2) break;
      sc.scrollTop += delta;
      await sleep(30);
    }

    const msg = el.querySelector(".jct-msg") || el;
    msg.classList.remove("jct-flash");
    void msg.offsetWidth; // restart the animation
    msg.classList.add("jct-flash");
    setTimeout(() => msg.classList.remove("jct-flash"), 1600);
    return true;
  }

  function messageText(i) {
    const store = getMessagesStore();
    if (store) {
      const m = resolveEntry(store, i);
      if (m && typeof m.message === "string") return m.message;
    }
    // Fallback: rendered text (loses the asterisk formatting).
    const body = document.querySelector(`[data-index="${i}"] [class*="messageBody"]`);
    const content = body && body.children[1];
    return content ? content.innerText : null;
  }

  function copyText(text) {
    // Must run synchronously inside the click handler for Safari.
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(() => true, () => legacyCopy(text));
    }
    return Promise.resolve(legacyCopy(text));
  }

  function legacyCopy(text) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    ta.remove();
    return ok;
  }

  let copyMode = false;

  function setStatus(text) {
    const el = document.querySelector(`#${FLYOUT_ID} .jct-jump-status`);
    if (el) el.textContent = text;
  }

  function setCopyMode(on) {
    copyMode = on;
    const fly = document.getElementById(FLYOUT_ID);
    if (!fly) return;
    fly.classList.toggle("jct-copy-mode", on);
    const btn = fly.querySelector(".jct-jump-copy");
    btn.setAttribute("aria-pressed", String(on));
    setStatus(on ? "Copy mode: pick a message to copy" : "Pick a message to jump to");
  }

  function pick(i) {
    if (copyMode) {
      const text = messageText(i);
      if (text == null) {
        setStatus(`Couldn't read #${i + 1}`);
        return;
      }
      copyText(text).then((ok) => setStatus(ok ? `Copied #${i + 1}` : `Copy failed for #${i + 1}`));
      copyMode = false;
      const fly = document.getElementById(FLYOUT_ID);
      if (fly) {
        fly.classList.remove("jct-copy-mode");
        fly.querySelector(".jct-jump-copy").setAttribute("aria-pressed", "false");
      }
      return;
    }
    closeFlyout();
    jumpTo(i);
  }

  function buildFlyout() {
    const fly = document.createElement("div");
    fly.id = FLYOUT_ID;
    fly.setAttribute("role", "dialog");
    fly.setAttribute("aria-label", "Jump to message");
    fly.innerHTML = `
      <div class="jct-jump-main">
        <div class="jct-jump-head">
          <input class="jct-jump-input" type="number" min="1" inputmode="numeric" placeholder="#" aria-label="Message number">
          <span class="jct-jump-status"></span>
        </div>
        <div class="jct-jump-grid"></div>
      </div>
      <button type="button" class="jct-jump-copy" aria-pressed="false" title="Copy the next message you pick">Copy</button>
    `;
    fly.addEventListener("click", (e) => {
      const num = e.target.closest(".jct-jump-num");
      if (num) pick(+num.dataset.i);
      else if (e.target.closest(".jct-jump-copy")) setCopyMode(!copyMode);
    });
    fly.querySelector(".jct-jump-input").addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      const n = parseInt(e.target.value, 10);
      const total = fly.querySelectorAll(".jct-jump-num").length;
      if (n >= 1 && n <= total) pick(n - 1);
      else setStatus(`Pick 1 to ${total}`);
    });
    return fly;
  }

  function positionFlyout(fly, btn) {
    // Line up with the button, but sit above the whole input box so the
    // flyout never covers what you're typing.
    const r = btn.getBoundingClientRect();
    const box = btn.closest('[class*="chatInputInner"]') || btn;
    const top = Math.min(r.top, box.getBoundingClientRect().top);
    const margin = 8;
    fly.style.left = `${Math.max(margin, Math.min(r.left, window.innerWidth - fly.offsetWidth - margin))}px`;
    fly.style.bottom = `${window.innerHeight - top + 6}px`;
  }

  function openFlyout(btn) {
    let fly = document.getElementById(FLYOUT_ID);
    if (!fly) {
      fly = buildFlyout();
      document.body.appendChild(fly);
    }
    const msgs = listMessages();
    const current = currentIndex();
    const grid = fly.querySelector(".jct-jump-grid");
    grid.innerHTML = msgs
      .map((m, i) => {
        const cls = `jct-jump-num ${m.isBot ? "jct-jump-bot" : "jct-jump-user"}${i === current ? " jct-jump-current" : ""}`;
        return `<button type="button" class="${cls}" data-i="${i}" title="${m.isBot ? "Bot" : "You"}">${i + 1}</button>`;
      })
      .join("");
    const input = fly.querySelector(".jct-jump-input");
    input.value = "";
    input.max = String(msgs.length);
    setCopyMode(false);
    fly.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    positionFlyout(fly, btn);
    const cur = grid.querySelector(".jct-jump-current");
    if (cur) cur.scrollIntoView({ block: "nearest" });
  }

  function closeFlyout() {
    const fly = document.getElementById(FLYOUT_ID);
    if (fly) fly.hidden = true;
    const btn = document.getElementById(JUMP_BTN_ID);
    if (btn) btn.setAttribute("aria-expanded", "false");
    copyMode = false;
  }

  function isFlyoutOpen() {
    const fly = document.getElementById(FLYOUT_ID);
    return !!fly && !fly.hidden;
  }

  // Called from the MutationObserver pass: (re)insert the button whenever
  // React re-renders the bottom bar or you switch chats.
  function ensureJumpButton() {
    const left = document.querySelector('[class*="controlsLeft"]');
    if (!left) {
      if (isFlyoutOpen()) closeFlyout();
      return;
    }
    if (left.querySelector(`#${JUMP_BTN_ID}`)) return;
    const old = document.getElementById(JUMP_BTN_ID);
    if (old) old.remove();
    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = JUMP_BTN_ID;
    btn.textContent = "#";
    btn.title = "Jump to or copy a message";
    btn.setAttribute("aria-label", "Jump to message");
    btn.setAttribute("aria-haspopup", "dialog");
    btn.setAttribute("aria-expanded", "false");
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (isFlyoutOpen()) closeFlyout();
      else {
        closeExportFlyout();
        closeStripFlyout();
        openFlyout(btn);
      }
    });
    left.appendChild(btn);
  }

  /******************************************************************
   * Chat export to Markdown
   *
   * Adds an "Export" button to the right of the "#" picker. It opens a
   * small flyout with an "Include my persona" checkbox (remembered between
   * visits) and a Download button that saves the whole chat as a .md file.
   * Messages are written with their raw text, so *actions* stay italic in
   * Markdown. Like the picker, this reads the site's chat store, so every
   * message is included even when the list hasn't rendered it.
   ******************************************************************/
  const EXPORT_BTN_ID = "jct-export-btn";
  const EXPORT_FLYOUT_ID = "jct-export-flyout";
  const PERSONA_PREF_KEY = "jct-export-include-persona";

  function readPref(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : v === "1";
    } catch (e) {
      return fallback;
    }
  }
  function writePref(key, on) {
    try { localStorage.setItem(key, on ? "1" : "0"); } catch (e) { /* ignore */ }
  }

  // The persona this chat uses: the active one, else the one the chat names.
  function chatPersona(cs) {
    const info = cs.chatInfo || {};
    const wanted = info.chat && info.chat.persona_id;
    const list = Array.isArray(info.personas) ? info.personas : [];
    const active = cs.activePersona;
    if (active && active.name && (!wanted || active.id === wanted)) return active;
    return list.find((p) => p && p.id === wanted) || active || list.find((p) => p && p.is_default) || null;
  }

  function buildMarkdown(includePersona) {
    const cs = getChatStore();
    if (!cs) return null;
    const store = cs.messagesStore;
    const info = cs.chatInfo || {};
    const character = info.character || {};
    const persona = chatPersona(cs);

    const charName = (character.chat_name || character.name || "Character").trim();
    const userName = ((persona && persona.name) || "You").trim();
    const title = (character.name || charName).trim();
    // Greetings and some replies still hold the {{user}} / {{char}} macros.
    // Single line breaks become Markdown hard breaks (two trailing spaces)
    // so they don't get merged into one paragraph when the file is viewed.
    const fill = (t) => String(t)
      .replace(/\{\{\s*user\s*\}\}/gi, userName)
      .replace(/\{\{\s*char\s*\}\}/gi, charName)
      .replace(/\r\n?/g, "\n")
      .replace(/[ \t]*\n(?!\n)/g, (m, off, str) => (off > 0 && str[off - 1] === "\n" ? "\n" : "  \n"));

    const out = [`# ${title}`, ""];
    const count = store.messages.length;
    out.push(`_Exported from [JanitorAI](${location.href}) on ${new Date().toLocaleString()} · ${count} message${count === 1 ? "" : "s"}_`, "");

    if (includePersona && persona) {
      out.push(`## Persona: ${userName}`, "");
      const about = persona.appearance ? fill(persona.appearance).trim() : "";
      out.push(about || "_No persona description._", "");
    }

    out.push("---", "");
    for (let i = 0; i < count; i++) {
      const m = resolveEntry(store, i);
      if (!m) continue;
      out.push(`### #${i + 1} · ${m.is_bot ? charName : userName}`, "");
      out.push(fill(typeof m.message === "string" ? m.message : "").trim(), "");
    }
    return { text: out.join("\n").replace(/\n{3,}/g, "\n\n"), title, count };
  }

  function safeFileName(name) {
    const base = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${base || "chat"} ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.md`;
  }

  function downloadText(text, filename) {
    // Must run synchronously inside the click handler for Safari.
    const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  function setExportStatus(text) {
    const el = document.querySelector(`#${EXPORT_FLYOUT_ID} .jct-export-status`);
    if (el) el.textContent = text;
  }

  function doExport() {
    const fly = document.getElementById(EXPORT_FLYOUT_ID);
    const include = !!(fly && fly.querySelector(".jct-export-persona").checked);
    const md = buildMarkdown(include);
    if (!md) {
      setExportStatus("Couldn't read this chat");
      return;
    }
    downloadText(md.text, safeFileName(md.title));
    setExportStatus(`Saved ${md.count} message${md.count === 1 ? "" : "s"}`);
  }

  function buildExportFlyout() {
    const fly = document.createElement("div");
    fly.id = EXPORT_FLYOUT_ID;
    fly.setAttribute("role", "dialog");
    fly.setAttribute("aria-label", "Export chat");
    fly.innerHTML = `
      <label class="jct-export-row">
        <input type="checkbox" class="jct-export-persona">
        <span>Include my persona at the top</span>
      </label>
      <div class="jct-export-row">
        <button type="button" class="jct-export-go">Download .md</button>
        <span class="jct-export-status"></span>
      </div>
    `;
    const box = fly.querySelector(".jct-export-persona");
    box.checked = readPref(PERSONA_PREF_KEY, false);
    box.addEventListener("change", () => writePref(PERSONA_PREF_KEY, box.checked));
    fly.querySelector(".jct-export-go").addEventListener("click", doExport);
    return fly;
  }

  function openExportFlyout(btn) {
    if (isFlyoutOpen()) closeFlyout();
    let fly = document.getElementById(EXPORT_FLYOUT_ID);
    if (!fly) {
      fly = buildExportFlyout();
      document.body.appendChild(fly);
    }
    const cs = getChatStore();
    const n = cs ? cs.messagesStore.messages.length : 0;
    setExportStatus(cs ? `${n} message${n === 1 ? "" : "s"}` : "Chat not loaded yet");
    fly.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    positionFlyout(fly, btn);
  }

  function closeExportFlyout() {
    const fly = document.getElementById(EXPORT_FLYOUT_ID);
    if (fly) fly.hidden = true;
    const btn = document.getElementById(EXPORT_BTN_ID);
    if (btn) btn.setAttribute("aria-expanded", "false");
  }

  function isExportOpen() {
    const fly = document.getElementById(EXPORT_FLYOUT_ID);
    return !!fly && !fly.hidden;
  }

  function ensureExportButton() {
    const left = document.querySelector('[class*="controlsLeft"]');
    if (!left) {
      if (isExportOpen()) closeExportFlyout();
      return;
    }
    // Keep it directly to the right of the strip button (or the "#" picker).
    const prev = left.querySelector(`#${STRIP_BTN_ID}`) || left.querySelector(`#${JUMP_BTN_ID}`);
    const existing = left.querySelector(`#${EXPORT_BTN_ID}`);
    if (existing && (!prev || prev.nextElementSibling === existing)) return;
    const btn = existing || document.getElementById(EXPORT_BTN_ID) || createExportButton();
    if (prev) prev.after(btn);
    else left.appendChild(btn);
  }

  function createExportButton() {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = EXPORT_BTN_ID;
    btn.textContent = "Export";
    btn.title = "Export this chat as a Markdown file";
    btn.setAttribute("aria-haspopup", "dialog");
    btn.setAttribute("aria-expanded", "false");
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (isExportOpen()) closeExportFlyout();
      else {
        closeStripFlyout();
        openExportFlyout(btn);
      }
    });
    return btn;
  }

  /******************************************************************
   * Story notes stripper
   *
   * Adds an eraser button between the "#" picker and Export. It opens a
   * confirm flyout that says how many older bot replies still carry a
   * tracker line (cfg.trackerRegex). Confirming removes that line from
   * each of them, keeping the newest cfg.keepTrackerCount bot replies as
   * they are, and saves every edit through the site's own
   * messagesStore.editMessage (the same call the edit box's Save uses),
   * so the change is saved on JanitorAI, not just hidden.
   ******************************************************************/
  const STRIP_BTN_ID = "jct-strip-btn";
  const STRIP_FLYOUT_ID = "jct-strip-flyout";
  let stripRunning = false;

  function trackerRegex() {
    // Always a fresh copy so lastIndex never leaks between uses.
    try {
      return new RegExp(cfg.trackerRegex, "gim");
    } catch (e) {
      return new RegExp(DEFAULTS.trackerRegex, "gim");
    }
  }

  function keepCount() {
    return Math.max(0, parseInt(cfg.keepTrackerCount, 10) || 0);
  }

  // Older bot replies that still contain a tracker, with the text each one
  // should be saved as.
  function findStripTargets() {
    const cs = getChatStore();
    if (!cs) return null;
    const store = cs.messagesStore;
    const bots = [];
    for (let i = 0; i < store.messages.length; i++) {
      const m = resolveEntry(store, i);
      if (m && m.is_bot) bots.push(m);
    }
    const keep = keepCount();
    const older = keep > 0 ? bots.slice(0, -keep) : bots;
    const targets = [];
    for (const m of older) {
      if (typeof m.message !== "string") continue;
      if (typeof store.canEditMessage === "function" && !store.canEditMessage(m)) continue;
      const text = m.message.replace(trackerRegex(), "").replace(/\s+$/, "");
      if (text !== m.message.replace(/\s+$/, "") && text.trim()) targets.push({ m, text });
    }
    return { store, targets };
  }

  function setStripStatus(text) {
    const el = document.querySelector(`#${STRIP_FLYOUT_ID} .jct-strip-status`);
    if (el) el.textContent = text;
  }

  function refreshStripFlyout() {
    const fly = document.getElementById(STRIP_FLYOUT_ID);
    if (!fly) return;
    const go = fly.querySelector(".jct-strip-go");
    const info = fly.querySelector(".jct-strip-info");
    const found = findStripTargets();
    const keep = keepCount();
    const keepText = keep
      ? ` The newest ${keep} bot repl${keep === 1 ? "y keeps its" : "ies keep their"} notes.`
      : "";
    if (!found) {
      info.textContent = "Chat not loaded yet.";
      go.disabled = true;
      return;
    }
    const n = found.targets.length;
    info.textContent = n
      ? `Remove the story notes from ${n} older bot repl${n === 1 ? "y" : "ies"} and save the edit${n === 1 ? "" : "s"}? This can't be undone.${keepText}`
      : `No older replies have story notes.${keepText}`;
    go.disabled = n === 0;
  }

  async function doStrip() {
    if (stripRunning) return;
    const found = findStripTargets();
    if (!found || !found.targets.length) {
      refreshStripFlyout();
      return;
    }
    stripRunning = true;
    const go = document.querySelector(`#${STRIP_FLYOUT_ID} .jct-strip-go`);
    if (go) go.disabled = true;
    const { store, targets } = found;
    let done = 0;
    let failed = 0;
    for (const t of targets) {
      setStripStatus(`Saving ${done + failed + 1} of ${targets.length}…`);
      // editMessage quietly does nothing while another edit is in flight.
      for (let w = 0; w < 50 && store.isMessageProcessing; w++) await sleep(100);
      let ok = false;
      try { ok = await store.editMessage(t.m, t.text); } catch (e) { ok = false; }
      if (ok) done++;
      else failed++;
    }
    stripRunning = false;
    refreshStripFlyout();
    setStripStatus(failed
      ? `Cleaned ${done}, ${failed} failed`
      : `Cleaned ${done} repl${done === 1 ? "y" : "ies"}`);
  }

  function buildStripFlyout() {
    const fly = document.createElement("div");
    fly.id = STRIP_FLYOUT_ID;
    fly.setAttribute("role", "dialog");
    fly.setAttribute("aria-label", "Strip story notes");
    fly.innerHTML = `
      <div class="jct-strip-info"></div>
      <div class="jct-export-row">
        <button type="button" class="jct-strip-go">Strip notes</button>
        <span class="jct-strip-status"></span>
      </div>
    `;
    fly.querySelector(".jct-strip-go").addEventListener("click", doStrip);
    return fly;
  }

  function openStripFlyout(btn) {
    if (isFlyoutOpen()) closeFlyout();
    if (isExportOpen()) closeExportFlyout();
    let fly = document.getElementById(STRIP_FLYOUT_ID);
    if (!fly) {
      fly = buildStripFlyout();
      document.body.appendChild(fly);
    }
    if (!stripRunning) {
      setStripStatus("");
      refreshStripFlyout();
    }
    fly.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    positionFlyout(fly, btn);
  }

  function closeStripFlyout() {
    const fly = document.getElementById(STRIP_FLYOUT_ID);
    if (fly) fly.hidden = true;
    const btn = document.getElementById(STRIP_BTN_ID);
    if (btn) btn.setAttribute("aria-expanded", "false");
  }

  function isStripOpen() {
    const fly = document.getElementById(STRIP_FLYOUT_ID);
    return !!fly && !fly.hidden;
  }

  function ensureStripButton() {
    const left = document.querySelector('[class*="controlsLeft"]');
    if (!left) {
      if (isStripOpen()) closeStripFlyout();
      return;
    }
    // Keep it directly to the right of the "#" picker.
    const jump = left.querySelector(`#${JUMP_BTN_ID}`);
    const existing = left.querySelector(`#${STRIP_BTN_ID}`);
    if (existing && (!jump || jump.nextElementSibling === existing)) return;
    const btn = existing || document.getElementById(STRIP_BTN_ID) || createStripButton();
    if (jump) jump.after(btn);
    else left.appendChild(btn);
  }

  function createStripButton() {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = STRIP_BTN_ID;
    btn.title = "Strip story notes from older replies";
    btn.setAttribute("aria-label", "Strip story notes from older replies");
    btn.setAttribute("aria-haspopup", "dialog");
    btn.setAttribute("aria-expanded", "false");
    // Eraser icon.
    btn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 21h10"/><path d="M5.5 13.5 13 6a2 2 0 0 1 2.8 0l3.2 3.2a2 2 0 0 1 0 2.8l-7.5 7.5a2 2 0 0 1-1.4.5H8.3a2 2 0 0 1-1.4-.6L5.5 18a2 2 0 0 1 0-2.8z"/><path d="m9 10 5 5"/></svg>`;
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (isStripOpen()) closeStripFlyout();
      else openStripFlyout(btn);
    });
    return btn;
  }

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (isFlyoutOpen()) closeFlyout();
    if (isExportOpen()) closeExportFlyout();
    if (isStripOpen()) closeStripFlyout();
  });
  document.addEventListener("mousedown", (e) => {
    if (isFlyoutOpen() && !e.target.closest(`#${FLYOUT_ID}, #${JUMP_BTN_ID}`)) closeFlyout();
    if (isExportOpen() && !e.target.closest(`#${EXPORT_FLYOUT_ID}, #${EXPORT_BTN_ID}`)) closeExportFlyout();
    if (isStripOpen() && !e.target.closest(`#${STRIP_FLYOUT_ID}, #${STRIP_BTN_ID}`)) closeStripFlyout();
  }, true);
  window.addEventListener("resize", () => {
    const btn = document.getElementById(JUMP_BTN_ID);
    if (isFlyoutOpen() && btn) positionFlyout(document.getElementById(FLYOUT_ID), btn);
    const ebtn = document.getElementById(EXPORT_BTN_ID);
    if (isExportOpen() && ebtn) positionFlyout(document.getElementById(EXPORT_FLYOUT_ID), ebtn);
    const sbtn = document.getElementById(STRIP_BTN_ID);
    if (isStripOpen() && sbtn) positionFlyout(document.getElementById(STRIP_FLYOUT_ID), sbtn);
  });

  window.addEventListener("resize", () => { if (keepHeaderIcons()) scheduleTag(); });

  /******************************************************************
   * Settings panel
   *
   * A gear button at the end of the bottom bar (and a "Chat Tweaks
   * settings" entry in the userscript manager's menu) opens a dialog with
   * every setting. Saving stores them with GM_setValue and re-applies the
   * styles straight away, no reload needed.
   ******************************************************************/
  const SETTINGS_BTN_ID = "jct-settings-btn";
  const SETTINGS_OVERLAY_ID = "jct-settings-overlay";

  const FIELDS = [
    { section: "Chat bubbles" },
    { key: "bubbles", label: "Bubble style", type: "select", options: [
      ["joined", "One per message"],
      ["separated", "One per paragraph"],
      ["none", "None"],
    ] },
    { key: "alternating", label: "Right-aligned messages", type: "select", options: [
      ["off", "None"],
      ["userRight", "My messages"],
      ["botRight", "Bot messages"],
      ["bothRight", "Both"],
    ] },
    { key: "chatWidthPct", label: "Chat width (% of window)", hint: "0 keeps the site's own width.", type: "number", min: 0, max: 100 },
    { key: "userBubble", label: "My bubble color", type: "color" },
    { key: "darkenBotFromUser", label: "Make the bot bubble a darker shade of mine", type: "checkbox" },
    { key: "botBubble", label: "Bot bubble color", type: "color", disabledIf: (v) => v.darkenBotFromUser },
    { key: "botDarkenPct", label: "How much darker (%)", type: "number", min: 0, max: 100, disabledIf: (v) => !v.darkenBotFromUser },
    { section: "Header" },
    { key: "hideMusicPlayer", label: "Remove the music player", hint: "Turning this back off needs a page reload to bring the player back.", type: "checkbox" },
    { key: "autoHideHeader", label: "Hide the header until I hover the top edge", type: "checkbox" },
    { key: "alwaysShowProxyIcon", label: "Keep the proxy badge visible", type: "checkbox", disabledIf: (v) => !v.autoHideHeader },
    { key: "alwaysShowMenuIcon", label: "Keep the ☰ menu button visible", type: "checkbox", disabledIf: (v) => !v.autoHideHeader },
    { section: "Story notes stripper (eraser button)" },
    { key: "trackerRegex", label: "Tracker pattern (regular expression)", hint: "Used with the g, i and m flags.", type: "text", mono: true },
    { key: "keepTrackerCount", label: "Newest bot replies that keep their tracker", type: "number", min: 0, max: 999 },
  ];

  function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
    return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : null;
  }
  function rgbToHex(c) {
    return "#" + [c.r, c.g, c.b].map((n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, "0")).join("");
  }

  function buildField(f, values) {
    const row = document.createElement("div");
    row.className = "jct-set-row jct-set-" + f.type;
    row.dataset.key = f.key;
    const id = "jct-set-" + f.key;
    const label = document.createElement("label");
    label.htmlFor = id;
    label.className = "jct-set-label";
    label.textContent = f.label;
    let control;

    if (f.type === "checkbox") {
      control = document.createElement("input");
      control.type = "checkbox";
      control.id = id;
      control.checked = !!values[f.key];
      row.append(control, label);
    } else if (f.type === "select") {
      control = document.createElement("select");
      control.id = id;
      for (const [v, text] of f.options) {
        const o = document.createElement("option");
        o.value = v;
        o.textContent = text;
        control.appendChild(o);
      }
      control.value = values[f.key];
      row.append(label, control);
    } else if (f.type === "color") {
      const c = parseRgba(values[f.key]) || parseRgba(DEFAULTS[f.key]);
      const wrap = document.createElement("div");
      wrap.className = "jct-set-colorwrap";
      control = document.createElement("input");
      control.type = "color";
      control.id = id;
      control.value = rgbToHex(c);
      const alpha = document.createElement("input");
      alpha.type = "range";
      alpha.min = "0";
      alpha.max = "100";
      alpha.value = String(Math.round(c.a * 100));
      alpha.className = "jct-set-alpha";
      alpha.title = "Opacity";
      alpha.setAttribute("aria-label", f.label + " opacity");
      const out = document.createElement("span");
      out.className = "jct-set-alpha-out";
      const sync = () => { out.textContent = alpha.value + "%"; };
      alpha.addEventListener("input", sync);
      sync();
      wrap.append(control, alpha, out);
      row.append(label, wrap);
    } else {
      control = document.createElement("input");
      control.type = f.type === "number" ? "number" : "text";
      control.id = id;
      if (f.type === "number") {
        control.min = String(f.min);
        control.max = String(f.max);
        control.step = "1";
        control.inputMode = "numeric";
      }
      if (f.mono) control.classList.add("jct-set-mono");
      control.spellcheck = false;
      control.autocomplete = "off";
      control.value = String(values[f.key]);
      row.append(label, control);
    }
    if (f.hint) {
      const hint = document.createElement("div");
      hint.className = "jct-set-hint";
      hint.textContent = f.hint;
      row.appendChild(hint);
    }
    return row;
  }

  // Read the form back into a settings object. Returns { values, error }.
  function readForm(panel) {
    const values = Object.assign({}, cfg);
    for (const f of FIELDS) {
      if (!f.key) continue;
      const row = panel.querySelector(`.jct-set-row[data-key="${f.key}"]`);
      const control = row.querySelector("#jct-set-" + f.key);
      if (f.type === "checkbox") values[f.key] = control.checked;
      else if (f.type === "select") values[f.key] = control.value;
      else if (f.type === "number") {
        const n = parseInt(control.value, 10);
        values[f.key] = Number.isFinite(n) ? clamp(n, f.min, f.max) : DEFAULTS[f.key];
      } else if (f.type === "color") {
        const rgb = hexToRgb(control.value) || { r: 0, g: 0, b: 0 };
        const a = clamp((parseInt(row.querySelector(".jct-set-alpha").value, 10) || 0) / 100, 0, 1);
        values[f.key] = toRgba(Object.assign(rgb, { a: +a.toFixed(2) }));
      } else values[f.key] = control.value;
    }
    if (!values.trackerRegex.trim()) values.trackerRegex = DEFAULTS.trackerRegex;
    try {
      new RegExp(values.trackerRegex, "gim");
    } catch (e) {
      return { values, error: "Tracker pattern isn't a valid regular expression: " + e.message };
    }
    return { values, error: null };
  }

  function updateDisabled(panel) {
    const { values } = readForm(panel);
    for (const f of FIELDS) {
      if (!f.key || !f.disabledIf) continue;
      const row = panel.querySelector(`.jct-set-row[data-key="${f.key}"]`);
      const off = !!f.disabledIf(values);
      row.classList.toggle("jct-set-disabled", off);
      row.querySelectorAll("input, select").forEach((el) => { el.disabled = off; });
    }
  }

  function fillForm(panel, values) {
    const body = panel.querySelector(".jct-set-body");
    body.textContent = "";
    for (const f of FIELDS) {
      if (f.section) {
        const h = document.createElement("h3");
        h.className = "jct-set-section";
        h.textContent = f.section;
        body.appendChild(h);
      } else {
        body.appendChild(buildField(f, values));
      }
    }
    panel.querySelector(".jct-set-error").textContent = "";
    updateDisabled(panel);
  }

  function buildSettingsOverlay() {
    const overlay = document.createElement("div");
    overlay.id = SETTINGS_OVERLAY_ID;
    overlay.hidden = true;
    overlay.innerHTML = `
      <div class="jct-set-panel" role="dialog" aria-modal="true" aria-labelledby="jct-set-title">
        <div class="jct-set-head">
          <h2 id="jct-set-title">Chat Tweaks settings</h2>
          <button type="button" class="jct-set-x" aria-label="Close">×</button>
        </div>
        <div class="jct-set-body"></div>
        <div class="jct-set-error" role="alert"></div>
        <div class="jct-set-foot">
          <button type="button" class="jct-set-reset">Reset to defaults</button>
          <span class="jct-set-spacer"></span>
          <button type="button" class="jct-set-cancel">Cancel</button>
          <button type="button" class="jct-set-save">Save</button>
        </div>
      </div>`;
    const panel = overlay.querySelector(".jct-set-panel");
    overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) closeSettings(); });
    panel.addEventListener("input", () => updateDisabled(panel));
    panel.addEventListener("change", () => updateDisabled(panel));
    panel.querySelector(".jct-set-x").addEventListener("click", closeSettings);
    panel.querySelector(".jct-set-cancel").addEventListener("click", closeSettings);
    panel.querySelector(".jct-set-reset").addEventListener("click", () => fillForm(panel, DEFAULTS));
    panel.querySelector(".jct-set-save").addEventListener("click", () => {
      const { values, error } = readForm(panel);
      if (error) {
        panel.querySelector(".jct-set-error").textContent = error;
        return;
      }
      cfg = values;
      saveSettings(cfg);
      applyStyles();
      scheduleTag();
      closeSettings();
    });
    // Keep the site's own shortcuts from firing while typing in the panel.
    overlay.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") closeSettings();
    });
    return overlay;
  }

  function openSettings() {
    if (!document.body) return;
    closeFlyout();
    closeExportFlyout();
    closeStripFlyout();
    let overlay = document.getElementById(SETTINGS_OVERLAY_ID);
    if (!overlay) {
      overlay = buildSettingsOverlay();
      document.body.appendChild(overlay);
    }
    fillForm(overlay.querySelector(".jct-set-panel"), cfg);
    overlay.hidden = false;
    const first = overlay.querySelector(".jct-set-body select, .jct-set-body input");
    if (first) first.focus();
  }

  function closeSettings() {
    const overlay = document.getElementById(SETTINGS_OVERLAY_ID);
    if (overlay) overlay.hidden = true;
  }

  function ensureSettingsButton() {
    const left = document.querySelector('[class*="controlsLeft"]');
    if (!left) return;
    // Keep it at the end of our buttons, right of Export.
    const prev = left.querySelector(`#${EXPORT_BTN_ID}`);
    const existing = left.querySelector(`#${SETTINGS_BTN_ID}`);
    if (existing && (!prev || prev.nextElementSibling === existing)) return;
    const btn = existing || document.getElementById(SETTINGS_BTN_ID) || createSettingsButton();
    if (prev) prev.after(btn);
    else left.appendChild(btn);
  }

  function createSettingsButton() {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = SETTINGS_BTN_ID;
    btn.title = "Chat Tweaks settings";
    btn.setAttribute("aria-label", "Chat Tweaks settings");
    btn.setAttribute("aria-haspopup", "dialog");
    // Gear icon.
    btn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openSettings();
    });
    return btn;
  }

  if (typeof GM_registerMenuCommand === "function") {
    try { GM_registerMenuCommand("Chat Tweaks settings", openSettings); } catch (e) { /* ignore */ }
  }

  const SETTINGS_CSS = `
/* ===== Settings ===== */
#jct-settings-btn {
  height: 32px;
  width: 32px;
  margin-left: 6px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  background: transparent;
  color: rgba(255, 255, 255, 0.7);
  cursor: pointer;
  flex: none;
}
#jct-settings-btn:hover { background: rgba(255, 255, 255, 0.08); color: #fff; }
#jct-settings-overlay {
  position: fixed;
  inset: 0;
  z-index: 100000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
  box-sizing: border-box;
  background: rgba(0, 0, 0, 0.55);
  font: 14px/1.35 -apple-system, system-ui, "Segoe UI", Helvetica, Arial, sans-serif;
  color: rgba(255, 255, 255, 0.88);
}
#jct-settings-overlay[hidden] { display: none; }
#jct-settings-overlay * { box-sizing: border-box; }
#jct-settings-overlay .jct-set-panel {
  display: flex;
  flex-direction: column;
  width: min(460px, 100%);
  max-height: min(88vh, 760px);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 12px;
  background: rgb(36, 37, 41);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
  text-align: left;
  direction: ltr;
}
#jct-settings-overlay .jct-set-head {
  display: flex;
  align-items: center;
  padding: 12px 14px 8px 16px;
}
#jct-settings-overlay h2 { flex: 1; margin: 0; font-size: 16px; font-weight: 600; color: #fff; }
#jct-settings-overlay .jct-set-x {
  width: 30px; height: 30px;
  border: 0; border-radius: 6px;
  background: transparent;
  color: rgba(255, 255, 255, 0.7);
  font-size: 22px; line-height: 1;
  cursor: pointer;
}
#jct-settings-overlay .jct-set-x:hover { background: rgba(255, 255, 255, 0.08); color: #fff; }
#jct-settings-overlay .jct-set-body {
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: 0 16px 8px;
}
#jct-settings-overlay .jct-set-section {
  margin: 14px 0 6px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.5);
}
#jct-settings-overlay .jct-set-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 10px;
  padding: 6px 0;
}
#jct-settings-overlay .jct-set-label { flex: 1 1 180px; min-width: 0; cursor: pointer; }
#jct-settings-overlay .jct-set-checkbox .jct-set-label { flex: 1; }
#jct-settings-overlay .jct-set-text .jct-set-label { flex-basis: 100%; }
#jct-settings-overlay .jct-set-hint {
  flex-basis: 100%;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
}
#jct-settings-overlay .jct-set-checkbox .jct-set-hint { padding-left: 28px; }
#jct-settings-overlay .jct-set-disabled { opacity: 0.4; }
#jct-settings-overlay input[type="checkbox"] {
  width: 18px; height: 18px; margin: 0;
  accent-color: rgb(120, 170, 255);
  flex: none;
}
#jct-settings-overlay select,
#jct-settings-overlay input[type="number"],
#jct-settings-overlay input[type="text"] {
  height: 32px;
  padding: 0 8px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.25);
  color: #fff;
  font: inherit;
  font-size: 16px; /* keeps iOS Safari from zooming in */
}
#jct-settings-overlay select { flex: 0 1 220px; min-width: 0; }
#jct-settings-overlay select option { background: rgb(36, 37, 41); color: #fff; }
#jct-settings-overlay input[type="number"] { width: 80px; flex: none; }
#jct-settings-overlay input[type="text"] { width: 100%; }
#jct-settings-overlay .jct-set-mono { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 13px; }
#jct-settings-overlay .jct-set-colorwrap { display: flex; align-items: center; gap: 8px; flex: none; }
#jct-settings-overlay input[type="color"] {
  width: 40px; height: 30px; padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
}
#jct-settings-overlay .jct-set-alpha { width: 90px; accent-color: rgb(120, 170, 255); }
#jct-settings-overlay .jct-set-alpha-out { width: 36px; text-align: right; font-size: 12px; color: rgba(255, 255, 255, 0.6); }
#jct-settings-overlay .jct-set-error { padding: 0 16px; color: rgb(255, 140, 140); font-size: 13px; }
#jct-settings-overlay .jct-set-error:empty { display: none; }
#jct-settings-overlay .jct-set-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px 14px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}
#jct-settings-overlay .jct-set-spacer { flex: 1; }
#jct-settings-overlay .jct-set-foot button {
  height: 32px;
  padding: 0 12px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 6px;
  background: transparent;
  color: rgba(255, 255, 255, 0.8);
  font: 600 13px/1 -apple-system, system-ui, "Segoe UI", Helvetica, Arial, sans-serif;
  cursor: pointer;
}
#jct-settings-overlay .jct-set-foot button:hover { background: rgba(255, 255, 255, 0.08); color: #fff; }
#jct-settings-overlay .jct-set-foot .jct-set-save {
  border-color: rgb(120, 170, 255);
  background: rgb(120, 170, 255);
  color: #111;
}
#jct-settings-overlay .jct-set-foot .jct-set-save:hover { filter: brightness(1.1); background: rgb(120, 170, 255); color: #111; }
`;

  // Start after everything above is defined (the observer calls ensureJumpButton).
  if (document.body) startObserver();
  else document.addEventListener("DOMContentLoaded", startObserver, { once: true });

  /******************************************************************
   * CSS generation
   ******************************************************************/
  function buildCss() {
  const bubbleMode = cfg.bubbles; // separated|joined|none
  const { user: userC, bot: botC } = bubbleColors();
  const alt = cfg.alternating; // off|userRight|botRight|bothRight
  const widthPct = cfg.chatWidthPct;

  // Header icons kept visible while the header is auto-hidden.
  const keepIconSel = [
    cfg.alwaysShowProxyIcon && '[class*="apiTag"]',
    cfg.alwaysShowMenuIcon && '[class*="menuTrigger"]',
  ].filter(Boolean).join(", ");

  // "separated" styles each paragraph block, "joined" styles the whole message.
  const bubbleTarget = bubbleMode === "separated" ? ".jct-bubble > *" : ".jct-bubble";

  const css = `
/* ===== Variables ===== */
:root {
  --jbc-user-bubble: ${userC};
  --jbc-bot-bubble: ${botC};
}

/* ===== Chat bubbles ===== */
${bubbleMode !== "none" ? `
.jct-user ${bubbleTarget} {
  background: var(--jbc-user-bubble) !important;
  padding: 0.5rem !important;
  border-radius: 10px !important;
  width: fit-content !important;
}

.jct-bot ${bubbleTarget} {
  background: var(--jbc-bot-bubble) !important;
  padding: 0.5rem !important;
  border-radius: 10px !important;
  width: fit-content !important;
}
` : ""}

/* ===== Edit box =====
   Keep the edit box full width while a message is being edited. The site
   now wraps the textarea in an editor div, which used to inherit the
   bubble's width: fit-content and collapse to one character wide. */
.jct-editing,
.jct-editing > *:not([class*="NameContainer"]) {
  width: 100% !important;
  max-width: 100% !important;
}
.jct-editing textarea {
  width: 100% !important;
  min-width: 100% !important;
  box-sizing: border-box !important;
  direction: ltr !important;
  writing-mode: horizontal-tb !important;
}
.jct-editing > *:not([class*="NameContainer"]) * {
  direction: ltr;
}

/* ===== Chat width ===== */
${widthPct && widthPct > 0 ? `
[class*="messagesMain"],
[class*="chatInputInner"],
[class*="headerGrid"] {
  max-width: ${widthPct}vw !important;
}
` : ""}

/* ===== Alternating alignment ===== */
${(alt === "userRight" || alt === "bothRight") ? `
/* USER messages on right */
.jct-user { direction: rtl; width: 100%; }
.jct-user > [class*="messageControls"] { left: 0px; right: unset; }
.jct-user > * > * > * > * { direction: ltr; }
[alt="User Avatar Border"] { direction: rtl; right: 0px; }
` : ""}

${(alt === "botRight" || alt === "bothRight") ? `
/* BOT messages on right */
.jct-bot { direction: rtl; }
.jct-bot > [class*="messageControls"] { left: 0px; right: unset; }
.jct-bot [class*="nameContainer"] { direction: rtl !important; right: 0px; }

img[alt="Character Icon"] { margin-right: 0.5rem !important; }

.jct-bot [class*="messageBody"] > div > div {
  direction: ltr;
  text-align: right;
}

button[aria-label="continue this message" i] { margin-left: 20px !important; }
` : ""}

/* ===== Music player ===== */
${cfg.hideMusicPlayer ? `
[class*="soundcloudPlayer"] { display: none !important; }
` : ""}

/* ===== Auto-hide header =====
   Slide the header up out of view, leaving an invisible strip at the top
   of the screen. Hovering that strip (or tabbing into the header) brings
   it back. The short delay stops it vanishing while moving to the menu.
   The header is hidden with visibility (not opacity) so the proxy badge
   and menu button can opt back in; the ::after strip keeps it hoverable. */
${cfg.autoHideHeader ? `
[data-chat-header="true"] {
  transform: translateY(calc(-100% + 12px)) !important;
  visibility: hidden !important;
  transition: transform 0.2s ease 0.4s, visibility 0s linear 0.6s !important;
}
[data-chat-header="true"]::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 12px;
  visibility: visible;
}
[data-chat-header="true"]:hover,
[data-chat-header="true"]:focus-within {
  transform: none !important;
  visibility: visible !important;
  transition: transform 0.2s ease, visibility 0s !important;
}
${keepIconSel ? `
[data-chat-header="true"] :is(${keepIconSel}) {
  visibility: visible !important;
  transform: translateY(var(--jct-header-shift, 0px)) !important;
  transition: transform 0.2s ease 0.4s !important;
}
[data-chat-header="true"]:hover :is(${keepIconSel}),
[data-chat-header="true"]:focus-within :is(${keepIconSel}) {
  transform: none !important;
  transition: transform 0.2s ease !important;
}
` : ""}
` : ""}

/* ===== Message jump & copy picker ===== */
#jct-jump-btn,
#jct-strip-btn,
#jct-export-btn {
  height: 32px;
  min-width: 32px;
  padding: 0 10px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  background: transparent;
  color: rgba(255, 255, 255, 0.7);
  font: 600 14px/1 -apple-system, system-ui, "Segoe UI", Helvetica, Arial, sans-serif;
  cursor: pointer;
  flex: none;
}
#jct-strip-btn,
#jct-export-btn { margin-left: 6px; }
#jct-strip-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}
#jct-jump-btn:hover,
#jct-jump-btn[aria-expanded="true"],
#jct-strip-btn:hover,
#jct-strip-btn[aria-expanded="true"],
#jct-export-btn:hover,
#jct-export-btn[aria-expanded="true"] {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
}
#jct-jump-flyout {
  position: fixed;
  z-index: 1000;
  display: flex;
  gap: 6px;
  width: min(340px, calc(100vw - 16px));
  max-height: min(50vh, 360px);
  padding: 8px;
  box-sizing: border-box;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 10px;
  background: rgb(36, 37, 41);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
  color: rgba(255, 255, 255, 0.85);
  font: 13px/1.2 -apple-system, system-ui, "Segoe UI", Helvetica, Arial, sans-serif;
}
#jct-jump-flyout[hidden] { display: none; }
#jct-jump-flyout.jct-copy-mode {
  border-color: rgb(120, 170, 255);
  box-shadow: 0 0 0 1px rgb(120, 170, 255), 0 8px 24px rgba(0, 0, 0, 0.45);
}
#jct-jump-flyout .jct-jump-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
#jct-jump-flyout .jct-jump-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
#jct-jump-flyout .jct-jump-input {
  width: 64px;
  height: 28px;
  padding: 0 6px;
  box-sizing: border-box;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.25);
  color: #fff;
  font: inherit;
}
#jct-jump-flyout .jct-jump-status {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: rgba(255, 255, 255, 0.6);
}
#jct-jump-flyout.jct-copy-mode .jct-jump-status { color: rgb(150, 190, 255); }
#jct-jump-flyout .jct-jump-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(40px, 1fr));
  gap: 4px;
  overflow-y: auto;
  min-height: 0;
  -webkit-overflow-scrolling: touch;
}
#jct-jump-flyout .jct-jump-num {
  height: 30px;
  border: 1px solid transparent;
  border-radius: 6px;
  color: rgba(255, 255, 255, 0.85);
  font: inherit;
  cursor: pointer;
}
#jct-jump-flyout .jct-jump-bot { background: rgba(255, 255, 255, 0.06); }
#jct-jump-flyout .jct-jump-user { background: rgba(255, 255, 255, 0.14); }
#jct-jump-flyout .jct-jump-num:hover { background: rgba(255, 255, 255, 0.25); color: #fff; }
#jct-jump-flyout .jct-jump-current { border-color: rgba(255, 255, 255, 0.55); }
#jct-jump-flyout.jct-copy-mode .jct-jump-num:hover { background: rgba(120, 170, 255, 0.35); }
#jct-jump-flyout .jct-jump-copy {
  writing-mode: vertical-rl;
  padding: 8px 4px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 6px;
  background: transparent;
  color: rgba(255, 255, 255, 0.75);
  font: 600 12px/1 -apple-system, system-ui, "Segoe UI", Helvetica, Arial, sans-serif;
  letter-spacing: 0.05em;
  cursor: pointer;
}
#jct-jump-flyout .jct-jump-copy[aria-pressed="true"] {
  background: rgb(120, 170, 255);
  border-color: rgb(120, 170, 255);
  color: #111;
}
@keyframes jct-flash {
  0%, 40% { box-shadow: 0 0 0 2px rgba(120, 170, 255, 0.8); }
  100% { box-shadow: 0 0 0 2px rgba(120, 170, 255, 0); }
}
.jct-flash { animation: jct-flash 1.6s ease-out; border-radius: 10px; }

/* ===== Chat export ===== */
#jct-export-flyout,
#jct-strip-flyout {
  position: fixed;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: min(260px, calc(100vw - 16px));
  padding: 10px;
  box-sizing: border-box;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 10px;
  background: rgb(36, 37, 41);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
  color: rgba(255, 255, 255, 0.85);
  font: 13px/1.3 -apple-system, system-ui, "Segoe UI", Helvetica, Arial, sans-serif;
}
#jct-export-flyout[hidden],
#jct-strip-flyout[hidden] { display: none; }
#jct-strip-flyout { width: min(300px, calc(100vw - 16px)); }
#jct-export-flyout .jct-export-row,
#jct-strip-flyout .jct-export-row {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: default;
}
#jct-export-flyout label.jct-export-row { cursor: pointer; }
#jct-export-flyout .jct-export-persona {
  width: 16px;
  height: 16px;
  margin: 0;
  accent-color: rgb(120, 170, 255);
  flex: none;
}
#jct-export-flyout .jct-export-go,
#jct-strip-flyout .jct-strip-go {
  height: 28px;
  padding: 0 12px;
  border: 1px solid rgb(120, 170, 255);
  border-radius: 6px;
  background: rgb(120, 170, 255);
  color: #111;
  font: 600 13px/1 -apple-system, system-ui, "Segoe UI", Helvetica, Arial, sans-serif;
  cursor: pointer;
  flex: none;
}
#jct-export-flyout .jct-export-go:hover,
#jct-strip-flyout .jct-strip-go:hover { filter: brightness(1.1); }
#jct-strip-flyout .jct-strip-go[disabled] { opacity: 0.4; cursor: default; filter: none; }
#jct-export-flyout .jct-export-status,
#jct-strip-flyout .jct-strip-status {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: rgba(255, 255, 255, 0.6);
}

/* ===== Small quality-of-life ===== */
.chat-input-inner { background: none !important; }
`.trim();
  return css + "\n" + SETTINGS_CSS;
  }

  // One <style> element, rewritten whenever settings are saved.
  let styleEl = null;
  function applyStyles() {
    const css = buildCss();
    if (styleEl && styleEl.isConnected) {
      styleEl.textContent = css;
      return;
    }
    const added = typeof GM_addStyle === "function" ? GM_addStyle(css) : null;
    if (added && added.tagName === "STYLE") {
      styleEl = added;
    } else if (!added) {
      styleEl = document.createElement("style");
      styleEl.textContent = css;
      (document.head || document.documentElement).appendChild(styleEl);
    }
  }
  applyStyles();
})();
