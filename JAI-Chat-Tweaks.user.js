// ==UserScript==
// @name         Janitor Ai Chat Tweaks
// @namespace    https://github.com/ajrc0re/JanitorAiChatTweaks
// @version      1.2.0
// @description  Improves the JanitorAI Chat Interface
// @match        https://janitorai.com/*
// @run-at       document-start
// @grant        GM_addStyle
// @homepageURL  https://github.com/ajrc0re/JanitorAiChatTweaks
// @supportURL   https://github.com/ajrc0re/JanitorAiChatTweaks/issues
// @updateURL    https://raw.githubusercontent.com/ajrc0re/JanitorAiChatTweaks/main/JAI-Chat-Tweaks.user.js
// @downloadURL  https://raw.githubusercontent.com/ajrc0re/JanitorAiChatTweaks/main/JAI-Chat-Tweaks.user.js
// ==/UserScript==

(() => {
  /******************************************************************
   * CONFIG
   ******************************************************************/
  const cfg = {
    // Chat bubbles: "separated" | "joined" | "none"
    bubbles: "joined",

    // Alternating alignment:
    // "off" | "userRight" | "botRight" | "bothRight"
    alternating: "userRight",

    // Chat width percent (0 = default site width, otherwise 40..100 typical)
    chatWidthPct: 85,

    // Bubble colors (RGBA strings). Matches your Stylus intent.
    // If you want a “theme-like” color, just set these manually.
    userBubble: "rgba(24, 24, 24, 0.80)",

    // Bot bubble can optionally be darker
    botBubble: "rgba(26, 27, 22, 0.80)",

    // If true: botBubble is auto-darkened from userBubble instead of using botBubble
    darkenBotFromUser: false,

    // Darken amount for botBubble if darkenBotFromUser = true (0..100)
    botDarkenPct: 20,
  };

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

  const userC = cfg.userBubble;
  let botC = cfg.botBubble;

  if (cfg.darkenBotFromUser) {
    const parsed = parseRgba(cfg.userBubble);
    if (parsed) botC = toRgba(darken(parsed, cfg.botDarkenPct));
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

  function tagAll() {
    document.querySelectorAll(BODY_SEL).forEach(tagMessage);
    ensureJumpButton();
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
  function getMessagesStore() {
    const item = document.querySelector("[data-index]");
    const start = item && item.parentElement;
    if (!start) return null;
    const key = Object.keys(start).find((k) => k.startsWith("__reactFiber"));
    let f = key && start[key];
    for (let depth = 0; f && depth < 40; depth++, f = f.return) {
      const cs = f.memoizedProps && f.memoizedProps.chatStore;
      const ms = cs && cs.messagesStore;
      if (ms && Array.isArray(ms.messages)) return ms;
    }
    return null;
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
    const r = btn.getBoundingClientRect();
    const margin = 8;
    fly.style.left = `${Math.max(margin, Math.min(r.left, window.innerWidth - fly.offsetWidth - margin))}px`;
    fly.style.bottom = `${window.innerHeight - r.top + 6}px`;
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
      else openFlyout(btn);
    });
    left.appendChild(btn);
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isFlyoutOpen()) closeFlyout();
  });
  document.addEventListener("mousedown", (e) => {
    if (!isFlyoutOpen()) return;
    if (e.target.closest(`#${FLYOUT_ID}, #${JUMP_BTN_ID}`)) return;
    closeFlyout();
  }, true);
  window.addEventListener("resize", () => {
    const btn = document.getElementById(JUMP_BTN_ID);
    if (isFlyoutOpen() && btn) positionFlyout(document.getElementById(FLYOUT_ID), btn);
  });

  // Start after everything above is defined (the observer calls ensureJumpButton).
  if (document.body) startObserver();
  else document.addEventListener("DOMContentLoaded", startObserver, { once: true });

  /******************************************************************
   * CSS generation
   ******************************************************************/
  const bubbleMode = cfg.bubbles; // separated|joined|none
  const alt = cfg.alternating; // off|userRight|botRight|bothRight
  const widthPct = cfg.chatWidthPct;

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

/* ===== Message jump & copy picker ===== */
#jct-jump-btn {
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
#jct-jump-btn:hover,
#jct-jump-btn[aria-expanded="true"] {
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

/* ===== Small quality-of-life ===== */
.chat-input-inner { background: none !important; }
`.trim();

  GM_addStyle(css);
})();
