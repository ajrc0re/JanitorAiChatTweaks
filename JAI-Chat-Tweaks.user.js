// ==UserScript==
// @name         Janitor Ai Chat Tweaks
// @namespace    https://github.com/ajrc0re/JanitorAiChatTweaks
// @version      1.1.0
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

/* ===== Small quality-of-life ===== */
.chat-input-inner { background: none !important; }
`.trim();

  GM_addStyle(css);
})();
