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
 *
 * 4. Drag-and-drop:
 *    Dragging a tile reorders it within the current folder.  Dropping a
 *    bookmark onto a folder tile moves it into that folder.  Both gestures
 *    end in chrome.bookmarks.move(), so the real bookmark tree changes.
 *    A drop is only ever rendered from chrome.bookmarks.getChildren(), never
 *    from optimistic DOM moves, which keeps the grid in sync with the tree.
 */

'use strict';

// ── State ─────────────────────────────────────────────────────────────────────

/** ID of the top-level QuickDial folder. */
let quickDialRootId = null;

/**
 * Per-bookmark "open in new tab" preference.
 * Key: bookmark node ID (string). Value: true → new tab, false → same tab.
 * Default (missing key) is true (new tab).
 * Persisted in localStorage under 'quickdial_newTab'.
 */
let newTabPrefs = {};

function loadNewTabPrefs() {
  try {
    newTabPrefs = JSON.parse(localStorage.getItem('quickdial_newTab') || '{}');
  } catch {
    newTabPrefs = {};
  }
}

function saveNewTabPrefs() {
  localStorage.setItem('quickdial_newTab', JSON.stringify(newTabPrefs));
}

function getNewTabPref(id) {
  return id in newTabPrefs ? newTabPrefs[id] : true;
}

/** Applies the per-tile preference to a real link element. */
function applyNewTabPref(link, openInNewTab) {
  link.target = openInNewTab ? '_blank' : '_self';
  link.rel = openInNewTab ? 'noopener noreferrer' : '';
}

function setNewTabPref(id, value) {
  newTabPrefs[id] = value;
  saveNewTabPrefs();
}

/**
 * Navigation stack: array of { id: string, title: string }.
 * Index 0 is always the QuickDial root; last entry is the current folder.
 * NOTE: Not persisted — each new tab starts at the root (intentional).
 */
let currentPath = [];

/**
 * Tile drag-and-drop state.  `draggedNode`/`draggedTile` are set on
 * dragstart and cleared on dragend.  `suppressClickUntil` swallows the click
 * some browsers emit after a drag finishes.
 */
let draggedNode = null;
let draggedTile = null;
let suppressClickUntil = 0;

/**
 * Monotonic render token.  chrome.bookmarks.onMoved also fires for our own
 * move() calls, so a drop and the event listener can both start a render;
 * only the newest render is allowed to paint.
 */
let renderGeneration = 0;

// ── Helpers ───────────────────────────────────────────────────────────────────

function currentFolderId() {
  return currentPath[currentPath.length - 1]?.id ?? null;
}

// ── Initialisation ────────────────────────────────────────────────────────────

async function init() {
  try {
    loadNewTabPrefs();
    const root = await findOrCreateQuickDialFolder();
    quickDialRootId = root.id;
    currentPath = [{ id: root.id, title: 'QuickDial' }];

    // Wire up "Open Bookmark Manager" button now that DOM is ready.
    document.getElementById('open-manager-btn')?.addEventListener('click', () => {
      chrome.tabs.create({ url: 'chrome://bookmarks/' });
    });

    // Keep the grid in sync when bookmarks change elsewhere in Chrome.
    // Wrapped so the event argument is not mistaken for render options and
    // so background changes never steal focus from another widget.
    const onBookmarksChanged = () => renderGrid();
    chrome.bookmarks.onCreated.addListener(onBookmarksChanged);
    chrome.bookmarks.onRemoved.addListener(onBookmarksChanged);
    chrome.bookmarks.onChanged.addListener(onBookmarksChanged);
    chrome.bookmarks.onMoved.addListener(onBookmarksChanged);
    chrome.bookmarks.onChildrenReordered.addListener(onBookmarksChanged);

    const grid = document.getElementById('bookmark-grid');
    grid.addEventListener('dragover', handleGridDragOver);
    grid.addEventListener('dragleave', handleGridDragLeave);
    grid.addEventListener('drop', handleGridDrop);

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

/**
 * Returns the children of the folder at the end of currentPath.
 *
 * A folder can disappear while it is being viewed (deleted in the Bookmark
 * Manager, or removed by sync).  chrome.bookmarks.getChildren() then rejects
 * with "Invalid bookmark", so the path is trimmed back one ancestor at a time
 * until a folder that still exists is found.  If even the QuickDial root is
 * gone the error is rethrown for renderGrid() to recover from.
 */
async function childrenOfCurrentFolder() {
  while (currentPath.length > 1) {
    try {
      return await chrome.bookmarks.getChildren(currentFolderId());
    } catch (err) {
      console.warn('[QuickDial] Folder no longer exists, moving up one level:', err);
      currentPath.pop();
    }
  }

  if (!currentPath.length) throw new Error('QuickDial path is empty');
  return chrome.bookmarks.getChildren(currentFolderId());
}

/**
 * Renders the grid for the current folder.
 *
 * @param {{ focusFirst?: boolean }} [options] focusFirst puts keyboard focus on
 *   the first tile (or the empty-state button) after the render.  Focus is also
 *   restored when the grid held it before rendering, so a bookmark change that
 *   rebuilds the grid doesn't drop the user back to the top of the document.
 */
async function renderGrid({ focusFirst = false } = {}) {
  const generation = ++renderGeneration;
  const grid       = document.getElementById('bookmark-grid');
  const emptyState = document.getElementById('empty-state');

  // Remember where focus was before the tiles are replaced.
  const hadFocus = grid.contains(document.activeElement);
  const focusedId = hadFocus
    ? document.activeElement.closest('.tile')?.dataset.nodeId ?? null
    : null;

  // Clear previous tiles.
  grid.innerHTML = '';

  let shouldFocus = focusFirst;
  let children;

  try {
    children = await childrenOfCurrentFolder();
  } catch (err) {
    // The QuickDial root itself is gone — recreate it and reopen at the root.
    console.warn('[QuickDial] QuickDial folder is missing, recreating:', err);
    try {
      const root = await findOrCreateQuickDialFolder();
      quickDialRootId = root.id;
      currentPath = [{ id: root.id, title: 'QuickDial' }];
      children = await chrome.bookmarks.getChildren(root.id);
      shouldFocus = true;
    } catch (recoveryErr) {
      console.error('[QuickDial] Could not recover the QuickDial folder:', recoveryErr);
      if (generation !== renderGeneration) return;
      updateBreadcrumb();
      grid.hidden = true;
      emptyState.hidden = false;
      return;
    }
  }

  // A newer render started while this one was awaiting storage; let it win.
  if (generation !== renderGeneration) return;

  updateBreadcrumb();

  if (children.length === 0) {
    grid.hidden       = true;
    emptyState.hidden = false;
  } else {
    grid.hidden       = false;
    emptyState.hidden = true;

    for (const node of children) {
      grid.appendChild(createTile(node));
    }
  }

  if (!shouldFocus && !hadFocus) return;

  const restored = focusedId
    ? grid.querySelector(`.tile[data-node-id="${CSS.escape(focusedId)}"] .tile-link`)
    : null;
  const target = restored
    ?? grid.querySelector('.tile-link')
    ?? document.getElementById('open-manager-btn');
  target?.focus();
}

// ── Tile creation ─────────────────────────────────────────────────────────────

/**
 * Builds a DOM tile for one bookmark node.
 * URL node  → bookmark tile (favicon badge + title), the card is a link.
 * No-URL node → folder tile (SVG folder icon + title), the card is a button.
 *
 * The interactive element is a transparent overlay (`.tile-link`) rather than
 * the tile itself: the whole card is still the click target, but the "open in
 * new tab" checkbox can stay a sibling instead of being nested inside a link
 * (interactive content inside <a> is invalid and breaks click handling).
 */
function createTile(node) {
  const isBookmark = Boolean(node.url);

  const tile = document.createElement('div');
  tile.className = isBookmark ? 'tile bookmark-tile' : 'tile folder-tile';
  tile.setAttribute('role', 'listitem');
  tile.dataset.nodeId = node.id;
  tile.draggable = true;

  // Decorative gold accent wrapping the top-left corner and top edge.
  const accent = document.createElement('span');
  accent.className = 'tile-accent';
  accent.setAttribute('aria-hidden', 'true');
  tile.appendChild(accent);

  tile.appendChild(isBookmark ? buildFaviconBadge(node) : buildFolderIcon());

  const titleEl = document.createElement('span');
  titleEl.className = 'tile-title';
  titleEl.textContent = node.title || '(untitled)';
  tile.appendChild(titleEl);

  // A real <a>/<button> gives native keyboard activation, middle-click,
  // Ctrl/Cmd-click and the context menu without extra handlers.
  const action = document.createElement(isBookmark ? 'a' : 'button');
  action.className = 'tile-link';
  action.draggable = false; // let the tile govern dragging
  action.setAttribute('aria-label', node.title || '(untitled)');

  if (isBookmark) {
    action.href = node.url;
    applyNewTabPref(action, getNewTabPref(node.id));
  } else {
    action.type = 'button';
  }

  action.addEventListener('click', (e) => {
    // Drag-and-drop ends with a click in some browsers; don't open the tile
    // that was just moved.  Also ignore clicks while a drag is in flight.
    if (draggedTile || performance.now() < suppressClickUntil) {
      suppressClickUntil = 0;
      e.preventDefault();
      return;
    }

    if (!isBookmark) {
      e.preventDefault();
      // "Folder-navigation drill-in" — push folder onto path and re-render.
      currentPath.push({ id: node.id, title: node.title });
      renderGrid({ focusFirst: true });
    }
  });

  tile.appendChild(action);

  // "Open in new tab" checkbox overlay — bookmark tiles only.
  if (isBookmark) {
    const label = document.createElement('label');
    label.className = 'new-tab-checkbox-label';
    label.title = 'Open in new tab';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'new-tab-checkbox';
    checkbox.checked = getNewTabPref(node.id);
    checkbox.setAttribute('aria-label', 'Open in new tab');

    checkbox.addEventListener('change', (e) => {
      e.stopPropagation();
      setNewTabPref(node.id, checkbox.checked);
      applyNewTabPref(action, checkbox.checked);
    });

    // Prevent the label click from bubbling up and triggering the tile action.
    label.addEventListener('click', (e) => e.stopPropagation());

    label.appendChild(checkbox);
    tile.appendChild(label);
  }

  tile.addEventListener('dragstart', (e) => handleDragStart(e, node, tile));
  tile.addEventListener('dragend', handleDragEnd);

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
  img.draggable = false;

  try {
    const pageUrl = new URL(node.url).href;
    // Use the extension-supported favicon endpoint (requires "favicon" permission).
    img.src = chrome.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(pageUrl)}&size=64`);
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

/** Increments so each folder icon gets a unique SVG gradient ID. */
let folderIconGradientSeq = 0;

/** Folder icon: minimal SVG folder glyph, distinct from bookmark tiles. */
function buildFolderIcon() {
  const wrapper = document.createElement('div');
  wrapper.className = 'folder-icon-wrapper';
  const gradientId = `qd-folder-gold-${++folderIconGradientSeq}`;
  // Simple open-folder SVG (Material Design-inspired).
  wrapper.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true">
      <defs>
        <linearGradient id="${gradientId}" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#fff3b0"/>
          <stop offset="18%" stop-color="#ffe98a"/>
          <stop offset="38%" stop-color="#d4af37"/>
          <stop offset="58%" stop-color="#b8860b"/>
          <stop offset="76%" stop-color="#ffe98a"/>
          <stop offset="100%" stop-color="#d4af37"/>
        </linearGradient>
      </defs>
      <path fill="url(#${gradientId})" d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16
               c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
    </svg>
  `;
  return wrapper;
}

/** Returns a deterministic gold shade for fallback favicons. */
function deterministicHsl(str) {
  let hash = 0;
  for (let i = 0; i < (str?.length ?? 0); i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  // Fixed gold hue; only the lightness varies so fallbacks stay on-palette.
  const lightness = 34 + (Math.abs(hash) % 13);
  return `hsl(46, 65%, ${lightness}%)`;
}

// ── Drag-and-drop: reorder + move into a subfolder ────────────────────────────

function handleDragStart(e, node, tile) {
  draggedNode = node;
  draggedTile = tile;
  suppressClickUntil = 0;

  tile.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', node.id);
}

function handleDragEnd() {
  if (draggedTile) draggedTile.classList.remove('dragging');
  clearDropIndicators();

  if (draggedNode) {
    // Swallow the click that can follow a drag/drop gesture.
    suppressClickUntil = performance.now() + 300;
  }

  draggedNode = null;
  draggedTile = null;
}

function clearDropIndicators() {
  document
    .querySelectorAll('.tile.drop-before, .tile.drop-after, .tile.drop-into')
    .forEach((el) => el.classList.remove('drop-before', 'drop-after', 'drop-into'));
}

/**
 * Works out what a drop at the current pointer position would do.
 *
 * Returns { type: 'folder', folderId, tile } when a bookmark is over a
 * subfolder tile, { type: 'reorder', index, tile, before } for an insertion
 * gap, or null for no valid move.
 *
 * `index` is the insertion gap in the current child list.  Chrome's move()
 * adjusts the index itself when an item moves down within the same folder,
 * so passing the gap directly yields the expected final order.
 */
function resolveDropIntent(e, grid) {
  if (!draggedNode || !draggedTile) return null;

  const tiles = Array.from(grid.querySelectorAll('.tile'));
  const draggedIndex = tiles.indexOf(draggedTile);
  if (draggedIndex === -1) return null;
  const hoveredTile = e.target.closest?.('.tile');

  // A bookmark dropped on a subfolder moves into it.  Folder-into-folder
  // moves are deliberately not offered, to avoid creating cycles.
  if (hoveredTile && hoveredTile !== draggedTile && draggedNode.url
      && hoveredTile.classList.contains('folder-tile')) {
    return {
      type: 'folder',
      folderId: hoveredTile.dataset.nodeId,
      tile: hoveredTile,
    };
  }

  // No insertion gap while the pointer is still over the dragged tile.
  const draggedRect = draggedTile.getBoundingClientRect();
  if (e.clientX >= draggedRect.left && e.clientX <= draggedRect.right
      && e.clientY >= draggedRect.top && e.clientY <= draggedRect.bottom) {
    return null;
  }

  const target = hoveredTile && hoveredTile !== draggedTile
    ? hoveredTile
    : nearestTile(tiles, draggedTile, e.clientX, e.clientY);
  if (!target) return null;

  // Over a tile, the left/right half picks the gap; above or below it, the
  // vertical midpoint does.  This stays intuitive in a wrapping grid.
  const rect = target.getBoundingClientRect();
  const inRow = e.clientY >= rect.top && e.clientY <= rect.bottom;
  const before = inRow
    ? e.clientX < rect.left + rect.width / 2
    : e.clientY < rect.top + rect.height / 2;
  const index = tiles.indexOf(target) + (before ? 0 : 1);

  // Dropping either side of the dragged tile is a no-op.
  if (index === draggedIndex || index === draggedIndex + 1) return null;

  return { type: 'reorder', index, tile: target, before };
}

function nearestTile(tiles, exclude, x, y) {
  let nearest = null;
  let nearestDistance = Infinity;

  for (const tile of tiles) {
    if (tile === exclude) continue;

    const rect = tile.getBoundingClientRect();
    const dx = x - (rect.left + rect.width / 2);
    const dy = y - (rect.top + rect.height / 2);
    const distance = dx * dx + dy * dy;

    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = tile;
    }
  }

  return nearest;
}

function applyDropIntent(intent) {
  clearDropIndicators();
  if (!intent) return;

  if (intent.type === 'folder') {
    intent.tile.classList.add('drop-into');
  } else {
    intent.tile.classList.add(intent.before ? 'drop-before' : 'drop-after');
  }
}

function handleGridDragOver(e) {
  if (!draggedNode) return;

  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  applyDropIntent(resolveDropIntent(e, e.currentTarget));
}

function handleGridDragLeave(e) {
  if (!draggedNode) return;
  if (e.relatedTarget && e.currentTarget.contains(e.relatedTarget)) return;

  clearDropIndicators();
}

async function handleGridDrop(e) {
  if (!draggedNode) return;

  e.preventDefault();

  const node = draggedNode;
  const intent = resolveDropIntent(e, e.currentTarget);
  clearDropIndicators();

  if (!intent) return;

  try {
    if (intent.type === 'folder') {
      // No index: append to the end of the destination folder.
      await chrome.bookmarks.move(node.id, { parentId: intent.folderId });
    } else {
      await chrome.bookmarks.move(node.id, { index: intent.index });
    }
  } catch (err) {
    console.error('[QuickDial] Could not move bookmark:', err);
    return;
  }

  await renderGrid();
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
        renderGrid({ focusFirst: true });
      });
    }

    nav.appendChild(btn);
  });
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);
