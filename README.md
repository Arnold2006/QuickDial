# QuickDial Chrome Extension

A minimalist **new-tab** speed-dial extension for Chrome (Manifest V3) inspired by [Bliphome](https://github.com/folletto/Bliphome).

## Features

- **Bookmark-driven tiles** — displays all children of your *QuickDial* bookmarks folder as a responsive tile grid.
- **Subfolder navigation** — click a folder tile to drill into it; a breadcrumb trail lets you jump back to any ancestor (including the root) instantly.
- **Auto-created root folder** — on first run the extension creates a *QuickDial* folder in your Bookmarks Bar automatically.
- **Sync** — bookmarks stay in sync via Chrome Sync; the grid updates live when you add/move/remove bookmarks.
- **Resizable clock widget** — a digital clock (HH:MM:SS + full date) fixed in the top-right corner; drag its bottom-right corner to resize. Size is saved across sessions.
- **No build step** — plain HTML/CSS/JS, load unpacked in seconds.

---

## Loading the extension in Chrome (unpacked)

1. **Clone or download** this repository so you have the folder on your machine.

2. Open Chrome and navigate to `chrome://extensions`.

3. Enable **Developer mode** (toggle in the top-right corner of the page).

4. Click **"Load unpacked"** and select the root folder of this repository
   (the folder that contains `manifest.json`).

5. Open a **new tab** — you should see the QuickDial page immediately.

---

## Adding your first bookmarks

1. Press **Ctrl+Shift+O** (Windows/Linux) or **⌘+Option+B** (Mac) to open the Bookmark Manager, **or** click *"Open Bookmark Manager"* on the empty-state page.

2. In the left panel find the **QuickDial** folder (under *Bookmarks Bar*).

3. Add bookmarks or create sub-folders inside it.

4. Open a new tab — the grid updates automatically.

---

## Subfolder navigation

- **Folder tiles** are visually distinct (folder icon instead of a favicon).
- Click a folder tile to navigate into it.
- The **breadcrumb bar** at the top shows the current path; click any segment to jump back to that level.
- Each new tab opens at the QuickDial root (navigation state is not persisted — this is intentional to keep each session clean).

---

## Clock widget

- Displayed in the top-right corner on every new tab.
- **Resize**: drag the dotted handle in the bottom-right corner of the widget.
- The font size scales proportionally with the widget width.
- Size is saved automatically via `chrome.storage.local`.

---

## File structure

```
manifest.json        — MV3 manifest (permissions: bookmarks, storage)
newtab.html          — New-tab page markup
newtab.css           — All styles (dark navy theme)
newtab.js            — Bookmark grid, folder navigation, breadcrumb
clock-widget.js      — Digital clock + resize logic
icons/
  icon16.png
  icon48.png
  icon128.png
```

---

## Permissions used

| Permission   | Why                                                          |
|--------------|--------------------------------------------------------------|
| `bookmarks`  | Read the *QuickDial* folder; create it if missing; listen for changes |
| `storage`    | Persist the clock widget's size across sessions              |

No other permissions are requested.