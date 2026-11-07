// ==UserScript==
// @name         Janitor Ai Chat Tweaks
// @namespace    https://github.com/ajrc0re/JanitorAiChatTweaks
// @version      1.0.0
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
   * CSS generation
   ******************************************************************/
  const bubbleMode = cfg.bubbles; // separated|joined|none
  const alt = cfg.alternating; // off|userRight|botRight|bothRight
  const widthPct = cfg.chatWidthPct;

  const css = `
/* ===== Variables ===== */
:root {
  --jbc-user-bubble: ${userC};
  --jbc-bot-bubble: ${botC};
}

/* ===== Chat bubbles ===== */
${bubbleMode !== "none" ? `
/* Separated: style the inner message element */
${bubbleMode === "separated" ? `
[class*="messageContent"] > [class*="messageBody"]:has([class*="nameContainer"] > *:only-child) > :nth-child(2) > * {
  background: var(--jbc-user-bubble) !important;
  padding: 0.5rem !important;
  border-radius: 10px !important;
  width: fit-content !important;
}

[class*="messageContent"] > [class*="messageBody"]:not(:has([class*="nameContainer"] > *:only-child)) > :nth-child(2) > * {
  background: var(--jbc-bot-bubble) !important;
  padding: 0.5rem !important;
  border-radius: 10px !important;
  width: fit-content !important;
}
` : ""}

/* Joined: style the container (not textarea) */
${bubbleMode === "joined" ? `
[class*="messageContent"] > [class*="messageBody"]:has([class*="nameContainer"] > *:only-child) > :nth-child(2):not(textarea) {
  background: var(--jbc-user-bubble) !important;
  padding: 0.5rem !important;
  border-radius: 10px !important;
  width: fit-content !important;
}

[class*="messageContent"] > [class*="messageBody"]:not(:has([class*="nameContainer"] > *:only-child)) > :nth-child(2):not(textarea) {
  background: var(--jbc-bot-bubble) !important;
  padding: 0.5rem !important;
  border-radius: 10px !important;
  width: fit-content !important;
}
` : ""}
` : ""}

/* ===== Chat width ===== */
${widthPct && widthPct > 0 ? `
[class*="messagesMain"],
[class*="chatInputInner"],
[class*="headerGrid"] {
  max-width: ${widthPct}vw !important; /* matches your Stylus: "max-width: widerchat vw" */
}
` : ""}

/* ===== Alternating alignment ===== */
${(alt === "userRight" || alt === "bothRight") ? `
/* USER messages on right (message blocks where nameContainer has only-child) */
[class*="messageDisplayWrapper"]:has([class*="nameContainer"] > *:only-child) { direction: rtl; }
[class*="messageDisplayWrapper"]:has([class*="nameContainer"] > *:only-child) > [class*="messageControls"] { left: 0px; right: unset; }
[class*="messageDisplayWrapper"]:has([class*="nameContainer"] > *:only-child) > * > * > * > * { direction: ltr; }
[class*="messageDisplayWrapper"]:has([class*="nameContainer"] > *:only-child) { width: 100%; }
[class*="messageBody"] > textarea { direction: ltr; }
[alt="User Avatar Border"] { direction: rtl; right: 0px; }
` : ""}

${(alt === "botRight" || alt === "bothRight") ? `
/* BOT messages on right (NOT only-child) */
[class*="messageDisplayWrapper"]:not(:has([class*="nameContainer"] > *:only-child)) { direction: rtl; }
[class*="messageDisplayWrapper"]:not(:has([class*="nameContainer"] > *:only-child)) > [class*="messageControls"] { left: 0px; right: unset; }

/* These selectors were in your Stylus; keep them to hit various layouts */
[class*="nameContainer"]:not(:has( > *:only-child)),
.css-engd9i > * > .css-152lww3 > .css-wu7wgo,
.css-1tyx7t5:not(:has([class*="nameContainer"] > *:only-child)) {
  direction: rtl !important;
  right: 0px;
}

img[alt="Character Icon"] { margin-right: 0.5rem !important; }

[class*="messageBody"]:not(:has([class*="nameContainer"] > *:only-child)) > div > div {
  direction: ltr;
  text-align: right;
}

[class*="messageBody"]:not(:has([class*="nameContainer"] > *:only-child)) > textarea,
.css-90rc6r {
  direction: ltr;
}

button.css-1iata1c[aria-label="continue this message"] { margin-left: 20px !important; }
` : ""}

/* ===== Small quality-of-life from your snippet ===== */
.chat-input-inner { background: none !important; }
`.trim();

  GM_addStyle(css);
})();
