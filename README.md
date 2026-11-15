# QuickDial Chrome Extension

A minimalist **new-tab** speed-dial extension for Chrome (Manifest V3) inspired by [Bliphome](https://github.com/folletto/Bliphome).

## Features

- **Bookmark-driven tiles** — displays all children of your *QuickDial* bookmarks folder as a responsive tile grid.
- **Subfolder navigation** — click a folder tile to drill into it; a breadcrumb trail lets you jump back to any ancestor (including the root) instantly.
- **Drag to reorder** — drag any tile within the current folder; a vertical marker shows where it will land.
- **Move into a subfolder** — drop a bookmark onto a folder tile to move it into that folder; the folder highlights while hovered.
- **Auto-created root folder** — on first run the extension creates a *QuickDial* folder in your Bookmarks Bar automatically.
- **Sync** — bookmarks stay in sync via Chrome Sync; the grid updates live when you add/move/remove bookmarks.
- **Resizable clock widget** — a digital clock (HH:MM:SS + full date) fixed in the top-right corner; drag its bottom-right corner to resize. Size is saved across sessions.
- **TODO widget** — a resizable markdown-style checklist widget fixed below the clock; items persist across sessions via `chrome.storage.local`.
- **Uptime widget** — checks a configurable list of http/https sites and shows up/down status, HTTP code and response time; add or remove sites in its Config panel.
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

## Reordering and moving tiles

- **Reorder** — drag a tile and drop it between two tiles. The bright vertical marker shows the insertion point. This changes the real bookmark order, so it is reflected in the Bookmark Manager and syncs through Chrome Sync or Brave Sync.
- **Move into a folder** — drag a bookmark onto a folder tile; the folder highlights and the bookmark moves to the end of that folder. Dragging a folder onto another folder reorders it instead.
- Clicking still works normally: a drag never opens the tile it moved.

---

## Clock widget

- Displayed in the top-right corner on every new tab.
- **Resize**: drag the dotted handle in the bottom-right corner of the widget.
- The font size scales proportionally with the widget width.
- Size is saved automatically via `chrome.storage.local`.

---

## TODO widget

- Displayed directly below the clock widget on every new tab.
- Items are stored and shown in standard **markdown checklist syntax** (`- [ ] task` / `- [x] task`).
- **Toggle**: click the `- [ ]` / `- [x]` prefix to mark an item done or pending.
- **Edit**: click the task text to edit it inline; press **Enter** or click away to confirm. Clearing the text entirely removes the item.
- **Add**: type in the input field (plain text or full markdown syntax) and press **Enter** or click **+**.
- **Delete**: click the **×** button on any item.
- **Resize**: drag the bottom-right handle; size is saved via `chrome.storage.local`.
- All items persist across sessions (stored as a markdown string in `chrome.storage.local`).

---

## Uptime widget

- Displayed below the TODO widget.
- Each site is checked when a new tab opens and every 60 seconds while the tab is open.
- A green dot with **UP** means an HTTP 2xx response; a red dot with **DOWN** / **TIMEOUT** means a non-2xx response, a network error or an 8-second timeout.
- **Config**: click *Config* to reveal the add field and the × delete buttons. URLs may be entered with or without `https://`; only http/https sites are accepted.
- Sites are stored in `chrome.storage.local`. Checks run only while a new tab is open.

---

## File structure

```
manifest.json        — MV3 manifest (permissions: bookmarks, favicon, storage; host access: http/https)
newtab.html          — New-tab page markup
newtab.css           — All styles (black, dark-gray and gold theme)
newtab.js            — Bookmark grid, folder navigation, breadcrumb, drag/drop
clock-widget.js      — Digital clock + resize logic
todo-widget.js       — Markdown TODO list widget + resize logic
uptime-widget.js     — Website uptime checks + Config panel
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
| `favicon`    | Load site favicons via the `/_favicon/` endpoint             |
| `storage`    | Persist the clock/TODO widget state and the uptime site list across sessions |
| `host_permissions` | Request the configured http/https sites for uptime checks |

Host access is used only for the sites configured in the uptime widget.