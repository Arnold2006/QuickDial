/**
 * newtab.js — QuickDial
 *
 * Manages the bookmark tile grid on the Chrome new-tab page.
 *
 * High-level flow
 * ───────────────
 * 1. "QuickDial root-folder logic":
 *    On every new-tab open, we walk the top-level bookmark containers
 *    (Bookmarks Bar, Other Bookmarks, etc.) and look for a folder whose
 *    title is exactly "QuickDial".  If none exists we create it under the
 *    first available container.  This folder is the root of the QuickDial
 *    navigation tree.
 *
 * 2. "Folder-navigation (drill-in / return-to-root) logic":
 *    currentPath is an array of { id, title } objects starting at the
 *    QuickDial root.  Clicking a subfolder tile pushes onto currentPath
 *    and re-renders.  The breadcrumb lets users jump to any ancestor
 *    (including root) with one click.  currentPath is in-memory only —
 *    each new tab opens at the root.  This assumption is noted here
 *    intentionally per the spec.
 *
 * 3. Grid rendering:
 *    chrome.bookmarks.getChildren(folderId) returns all direct children.
 *    URL nodes → bookmark tiles (favicon + title).
 *    Folder nodes → folder tiles (SVG icon + title).
 */

'use strict';

// ── State ─────────────────────────────────────────────────────────────────────

/** ID of the top-level QuickDial folder. */
let quickDialRootId = null;

/**
 * Navigation stack: array of { id: string, title: string }.
 * Index 0 is always the QuickDial root; last entry is the current folder.
 * NOTE: Not persisted — each new tab starts at the root (intentional).
 */
let currentPath = [];

// ── Helpers ───────────────────────────────────────────────────────────────────

function currentFolderId() {
  return currentPath[currentPath.length - 1]?.id ?? null;
}

// ── Initialisation ────────────────────────────────────────────────────────────

async function init() {
  try {
    const root = await findOrCreateQuickDialFolder();
    quickDialRootId = root.id;
    currentPath = [{ id: root.id, title: 'QuickDial' }];

    // Wire up "Open Bookmark Manager" button now that DOM is ready.
    document.getElementById('open-manager-btn')?.addEventListener('click', () => {
      chrome.tabs.create({ url: 'chrome://bookmarks/' });
    });

    // Keep the grid in sync when bookmarks change elsewhere in Chrome.
    chrome.bookmarks.onCreated.addListener(renderGrid);
    chrome.bookmarks.onRemoved.addListener(renderGrid);
    chrome.bookmarks.onChanged.addListener(renderGrid);
    chrome.bookmarks.onMoved.addListener(renderGrid);

    await renderGrid();
  } catch (err) {
    console.error('[QuickDial] init error:', err);
  }
}

/**
 * "QuickDial root-folder logic"
 *
 * Walks every top-level bookmark container and returns the first folder
 * titled "QuickDial" found as a direct child.  Creates the folder under
 * the first container if none exists.
 */
async function findOrCreateQuickDialFolder() {
  const tree = await chrome.bookmarks.getTree();
  const virtualRoot = tree[0]; // chrome's invisible root node

  for (const container of (virtualRoot.children ?? [])) {
    for (const child of (container.children ?? [])) {
      if (!child.url && child.title === 'QuickDial') {
        return child; // found
      }
    }
  }

  // Not found — create under the first available container (Bookmarks Bar).
  const firstContainer = virtualRoot.children?.[0];
  return chrome.bookmarks.create({
    parentId: firstContainer?.id ?? '1',
    title: 'QuickDial',
  });
}

// ── Grid rendering ────────────────────────────────────────────────────────────

async function renderGrid() {
  const folderId = currentFolderId();
  if (!folderId) return;

  const grid      = document.getElementById('bookmark-grid');
  const emptyState = document.getElementById('empty-state');

  // Clear previous tiles.
  grid.innerHTML = '';

  // Update breadcrumb before potentially early-returning.
  updateBreadcrumb();

  const children = await chrome.bookmarks.getChildren(folderId);

  if (children.length === 0) {
    grid.hidden      = true;
    emptyState.hidden = false;
    return;
  }

  grid.hidden      = false;
  emptyState.hidden = true;

  for (const node of children) {
    grid.appendChild(createTile(node));
  }
}

// ── Tile creation ─────────────────────────────────────────────────────────────

/**
 * Builds a DOM tile for one bookmark node.
 * URL node  → bookmark tile (favicon badge + title).
 * No-URL node → folder tile (SVG folder icon + title).
 */
function createTile(node) {
  const tile = document.createElement('div');
  tile.className = node.url ? 'tile bookmark-tile' : 'tile folder-tile';
  tile.setAttribute('role', 'listitem');
  tile.setAttribute('tabindex', '0');
  tile.setAttribute('aria-label', node.title || '(untitled)');

  tile.appendChild(node.url ? buildFaviconBadge(node) : buildFolderIcon());

  const titleEl = document.createElement('span');
  titleEl.className = 'tile-title';
  titleEl.textContent = node.title || '(untitled)';
  tile.appendChild(titleEl);

  const activate = () => {
    if (node.url) {
      window.location.href = node.url;
    } else {
      // "Folder-navigation drill-in" — push folder onto path and re-render.
      currentPath.push({ id: node.id, title: node.title });
      renderGrid();
    }
  };

  tile.addEventListener('click', activate);
  tile.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      activate();
    }
  });

  return tile;
}

/** Favicon badge: circular image with an initial-letter fallback. */
function buildFaviconBadge(node) {
  const wrapper = document.createElement('div');
  wrapper.className = 'favicon-wrapper';

  const img = document.createElement('img');
  img.className = 'favicon';
  img.alt = '';
  img.setAttribute('loading', 'lazy');

  try {
    const pageUrl = new URL(node.url).toString();
    // Chrome's internal favicon endpoint also supports local-network hosts.
    img.src = `chrome://favicon2/?size=64&scale_factor=1x&page_url=${encodeURIComponent(pageUrl)}`;
  } catch {
    img.src = ''; // malformed URL → triggers onerror immediately
  }

  img.onerror = () => {
    // Fallback: deterministic-colored circle with the first letter of the title.
    wrapper.classList.add('favicon-fallback');
    wrapper.style.backgroundColor = deterministicHsl(node.title);
    wrapper.innerHTML = '';
    const letter = document.createElement('span');
    letter.textContent = (node.title || '?').charAt(0).toUpperCase();
    wrapper.appendChild(letter);
  };

  wrapper.appendChild(img);
  return wrapper;
}

/** Folder icon: minimal SVG folder glyph, distinct from bookmark tiles. */
function buildFolderIcon() {
  const wrapper = document.createElement('div');
  wrapper.className = 'folder-icon-wrapper';
  // Simple open-folder SVG (Material Design-inspired).
  wrapper.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16
               c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
    </svg>
  `;
  return wrapper;
}

/** Returns a deterministic HSL background color for fallback favicons. */
function deterministicHsl(str) {
  let hash = 0;
  for (let i = 0; i < (str?.length ?? 0); i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = ((hash % 360) + 360) % 360;
  return `hsl(${hue}, 45%, 40%)`;
}

// ── Breadcrumb ("folder-navigation return-to-root logic") ─────────────────────

/**
 * Renders a clickable breadcrumb trail above the grid.
 * Hidden entirely when at the QuickDial root (currentPath.length === 1).
 * Each ancestor segment is a button that jumps directly to that folder level.
 * The current folder is shown as non-interactive text.
 */
function updateBreadcrumb() {
  const nav = document.getElementById('breadcrumb');
  nav.innerHTML = '';

  const atRoot = currentPath.length <= 1;
  nav.hidden = atRoot;
  if (atRoot) return;

  currentPath.forEach(({ title }, index) => {
    if (index > 0) {
      const sep = document.createElement('span');
      sep.className = 'breadcrumb-sep';
      sep.textContent = '›';
      sep.setAttribute('aria-hidden', 'true');
      nav.appendChild(sep);
    }

    const btn = document.createElement('button');
    btn.className = 'breadcrumb-item';
    btn.textContent = title;

    const isLast = index === currentPath.length - 1;
    if (isLast) {
      btn.classList.add('breadcrumb-current');
      btn.setAttribute('aria-current', 'page');
      btn.disabled = true;
    } else {
      btn.classList.add('breadcrumb-link');
      btn.setAttribute('aria-label', `Go back to ${title}`);
      const targetIndex = index; // capture for closure
      btn.addEventListener('click', () => {
        // Slice path to the clicked ancestor and re-render.
        currentPath = currentPath.slice(0, targetIndex + 1);
        renderGrid();
      });
    }

    nav.appendChild(btn);
  });
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);
