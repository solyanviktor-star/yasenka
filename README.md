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
Two modes (⚙ settings / popup) gate her autonomous behavior — your clicks always work:
**😺 Normal** (she lives by her stats: a hidden *wildness* scale driven by hunger,
mood and neglect decides how mischievous she gets) · **😌 Calm** (no pranks, no chatter).
A *mischief slider* in the popup scales wildness from 😇 angel to 😈 gremlin.

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
- **Sickness & healing:** neglect her and she may fall ill (thermometer, green face) —
  heal her with 💊 and she trusts you more. She recovers by herself after a day.
- **Daily streak:** the first visit each day is celebrated; the streak grows XP bonuses.
- **Idle life engine:** a data-driven behavior library (hero manifest → weighted picker
  in `core/behavior.js`) — she sits, grooms, laughs, gets bored, poses — depending on
  her live stats. Adding a behavior = one manifest entry, no code.
- Mini-games are full rounds with HUD, scores and records: chase the cursor (45s),
  catch food (10 throws), zombie archer (5 stomps vs 3 bites), hide & seek (5 finds).
- 30+ frame animations (eat, pounce, sick, heal, level-up, tumble, dangle…),
  manifest-driven; generated with an AI sprite-sheet pipeline (`art/`).

### ✍️ Auto-replier (human-in-the-loop, off by default)
- Collects reply targets **without any external API**: from the timeline you already
  have open (DOM scan) or by @handles via Twitter's free syndication endpoints.
- Drafts replies with her AI brain (your Hermes/GPT), inserts them into the native
  composer — **you press Send yourself**. No auto-send, no auto-likes, daily cap,
  cross-session dedup of already-answered posts.

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
