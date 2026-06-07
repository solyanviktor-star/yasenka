<p align="center">
  <img src="assets/banner.png" alt="Yasenka — Browser Pet" width="320">
</p>

# 🐾 Yasenka — Browser Pet

A tiny catgirl named **Yasia** lives right on top of any web page. She walks and
runs along the page structure, can be dragged around and thrown, and you can pet
and feed her. Two real superpowers under the hood:

- **📥 Download videos from the page** — YouTube, TikTok, Twitter / X and Instagram.
- **📝 Notes & links** — jot down quick notes and links, saved locally in your browser.

> The interface is **English by default**. Press the **RU** button (in Yasia's
> speech bubble or in the popup) to switch to Russian — and back.

---

## ✨ Features

### 📥 Video downloader
Click Yasia → **Download video from the page**. She grabs the video from the
current page:

| Platform | Notes |
|----------|-------|
| **YouTube** | Quality = whatever the player has loaded (set 1080p in the player, let it buffer a bit, then download). |
| **TikTok** | The active clip from the feed, **without watermark**. |
| **Twitter / X** | The video from the open post. |
| **Instagram** | The active reel / post video. |
| Other sites | Any direct video on the page (best-effort). |

For TikTok / Instagram you can also paste a clip link into the field and download
exactly that one.

### 📝 Notes & links
Click Yasia → **Notes & links**. Type any text or link, hit **Save** — it stays
in `chrome.storage.local`. Links become clickable.

### 🐱 The pet itself
- Lives on **any site**, walks and **runs** across the page by default.
- **Drag & throw** her around — she flies with inertia and lands on page elements.
- **Feed** her meat from the popup; she gains XP and **levels up** (bigger & livelier).
- On **X (Twitter)** she walks up to posts and asks for a like — the like is placed
  **only when you click the pet**. No auto-actions, no automation.
- One setting: **Size** (default 180%). EN / RU language toggle.

---

## 🚀 Install (developer mode)

### Firefox (Mozilla)
1. Type `about:debugging` in the address bar.
2. Open **This Firefox**.
3. Click **Load Temporary Add-on…**
4. Select the **`manifest.json`** file in this folder.

### Chrome
1. Open **Manage extensions** (top-right menu → Extensions).
2. Turn on **Developer mode** (top-left toggle).
3. Click **Load unpacked**, open this folder and confirm.
4. **Reload any already-open tabs** — the extension is injected on page load, so it
   won't appear in old tabs until you refresh them.

A **🐾** button shows up at the bottom-right of the page — click it to show/hide Yasia.

> After editing the code: on `chrome://extensions` hit **↻** on the extension card,
> then **reload the website tab**.

---

## 🔒 Safety principle

Real actions on X happen **only** as a direct response to your click on the pet
(one click = one deliberate like, at human speed). Everything else is a visual
layer on top of the page — it never changes content and never sends anything out.
