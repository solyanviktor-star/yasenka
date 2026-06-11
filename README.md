# 🐾 Yasenka — Browser Pet with an AI Brain

![Yasenka banner](assets/banner.png)

Yasya is a catgirl who lives on top of any web page: she treats the page itself as a
platformer level — walking along headings, images and buttons, jumping between them,
climbing up to watch videos with you. Feed her, pet her, play mini-games with her,
ask her things — and she remembers you.

> **Safety first:** the extension performs **no automated actions** on any site.
> A central guard (`core/guard.js`) enforces the hard rules: no likes, follows,
> comments or deletions without an explicit user confirmation (there is no such
> automation in the code at all — any future code must go through the guard);
> rapid downloads require confirmation; page text goes to the AI only after a
> per-site permission prompt — and in Safe mode it never leaves the browser.

### 🎚 Behavior modes
Five modes (⚙ settings) gate her autonomous behavior — your clicks always work:
**🎮 Game** (everything on) · **😌 Calm** (no pranks/chatter) · **💼 Work**
(never distracts, doesn't run to videos) · **🤖 AI** (assistant first) ·
**🛡 Safe** (AI off, site journal paused — nothing leaves the browser).

## What she can do

### 🕹 Lives on the page like a platformer
- DOM elements (posts, headings, images, buttons) become **ledges**: she walks them,
  jumps gaps, drops down with gravity, climbs toward a playing video and sits to watch.
- Drag her, throw her, scroll — she rides the elements and lands on her feet.
- If the video is too high to reach, she asks you to lift her up.

### 🤖 AI brain (Hermes Agent or OpenAI GPT)
- Connect a local [Hermes Agent](https://github.com/NousResearch/hermes-agent) server,
  an OpenAI API key, or sign in with a ChatGPT subscription (device-code flow).
- **Intent router:** type a request in her window — she figures out whether one of her
  own tools fits (“download this video” → opens the downloader) or answers directly.
- **Live tool status** (Hermes): while the agent searches the web or runs code,
  Yasya narrates what is happening (“🔍 searching the web…”).
- **Text-selection menu:** explain, translate, summarize, draft replies — on any site.
- Page context (URL, title, visible text, optional screenshot) is attached so she
  always knows where she is.

### 🧠 Memory — works with ANY provider
- **User model:** durable facts and preferences extracted from your conversations
  (a small follow-up LLM call), merged and deduplicated over time.
- **Site journal:** she remembers which sites you visited together — ask
  “remember that site about X?” and she finds it. No LLM involved, fully local.
- Everything is stored in `chrome.storage.local`, viewable and erasable from her panel.

### ⏰ Reminders
- “Remind me in 10 minutes to check the build” — she pops up on the page and says it.
- Powered by `chrome.alarms`; missed reminders are delivered when a page next opens.

### 📥 Video downloads
- Downloads videos from X/Twitter, TikTok, Instagram and YouTube
  (with watermark-free TikTok and experimental YouTube paths).

### 🐱 Tamagotchi care, games and moods
- Hunger, energy, mood, bond and XP; feed her, pet her, wake her up.
- Mini-games: chase the cursor, catch food, zombie archer, hide & seek.
- Full frame animation, manifest-driven: a new hero or emotion is data
  (a sprite folder + `manifest.json`), no logic changes.

## Install (developer mode)

1. Clone the repo and open `chrome://extensions`.
2. Enable **Developer mode** → **Load unpacked** → select the repo folder.
3. Click the pet — her window opens. AI features are optional and live under the
   🤖 panel (Hermes address/key, OpenAI key, or ChatGPT sign-in).

## Architecture

```
src/
  core/        config, storage, events (pub/sub bus), flags (feature toggles),
               registry (plugin system with crash isolation), heroes, physics,
               i18n (RU/EN dictionary)
  systems/     notes, games, memory, ai — independent plugins; a crashed system
               disables its own flag, the pet keeps living
  pet.js       the pet itself: platformer state machine, care, dialog window
  background.js service worker: downloads, AI proxy (CORS), streaming port,
               reminders, ChatGPT device-code auth
```

- Systems talk to each other **only** through the event bus and a narrow pet API.
- All LLM traffic goes through the background service worker (no CORS issues,
  localhost Hermes works from HTTPS pages).
- Keys are stored locally (`chrome.storage.local`) and never synced.

## Development

```bash
npm test    # unit tests (node:test, zero dependencies)
```

Branches: `main` is stable, `dev` is active development; features land in `main`
via PR after live testing.

## License

No license yet — all rights reserved for now.
