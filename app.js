/* QuickDial - Application Logic */

(() => {
  "use strict";

  const state = {
    quickDialId: null,
    currentFolderId: null,
    navStack: [],
    settings: { use24h: false, darkMode: true, showGreeting: true },
  };

  // ── Init ────────────────────────────
  init();

  async function init() {
    loadSettings();
    applySettings();
    await ensureQuickDialFolder();
    setupClock();
    setupDragDrop();
    setupCtxMenu();
    setupSettings();
    await renderGrid();

    // Auto-refresh on any bookmark change
    chrome.bookmarks.onCreated.addListener(() => renderGrid());
    chrome.bookmarks.onChanged.addListener(() => renderGrid());
    chrome.bookmarks.onRemoved.addListener(() => renderGrid());
  }

  // ── Settings ────────────────────────
  function loadSettings() {
    chrome.storage.local.get("qd-settings", (r) => {
      if (r["qd-settings"]) Object.assign(state.settings, r["qd-settings"]);
    });
  }

  function saveSettings() {
    chrome.storage.local.set({ "qd-settings": state.settings });
  }

  function applySettings() {
    document.getElementById("toggle-24h").checked = state.settings.use24h;
    document.getElementById("toggle-dark").checked = state.settings.darkMode;
    document.getElementById("toggle-greeting").checked = state.settings.showGreeting;
    updateClock();
  }

  function setupSettings() {
    document.getElementById("toggle-24h").onchange = () => {
      state.settings.use24h = !state.settings.use24h;
      saveSettings();
      updateClock();
    };
    document.getElementById("toggle-dark").onchange = () => {
      state.settings.darkMode = !state.settings.darkMode;
      saveSettings();
      applySettings();
    };
    document.getElementById("toggle-greeting").onchange = () => {
      state.settings.showGreeting = !state.settings.showGreeting;
      saveSettings();
      updateGreeting();
    };
    document.getElementById("btn-close-settings").onclick = () => {
      document.getElementById("settings-panel").hidden = true;
    };
  }

  // ── Clock ───────────────────────────
  function setupClock() {
    updateClock();
    setInterval(updateClock, 1000);
  }

  function updateClock() {
    const now = new Date();
    const timeStr = new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      hour12: !state.settings.use24h,
    }).format(now);
    const dateStr = new Intl.DateTimeFormat(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    }).format(now);
    document.getElementById("clock").innerHTML = `<div class="time">${timeStr}</div><div class="date">${dateStr}</div>`;
    updateGreeting();
  }

  function updateGreeting() {
    if (!state.settings.showGreeting) {
      document.getElementById("greeting").textContent = "";
      return;
    }
    const h = new Date().getHours();
    const greet = h < 6 ? "Good night" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
    document.getElementById("greeting").textContent = greet;
  }

  // ── QuickDial Folder ────────────────
  async function ensureQuickDialFolder() {
    return new Promise((resolve) => {
      chrome.bookmarks.search({ title: "QuickDial" }, (results) => {
        const folder = results.find(b => b.title === "QuickDial" && !b.url);
        if (folder) {
          state.quickDialId = folder.id;
          state.currentFolderId = folder.id;
          resolve();
          return;
        }
        // Create at root
        chrome.bookmarks.create({ title: "QuickDial" }, (newFolder) => {
          state.quickDialId = newFolder.id;
          state.currentFolderId = newFolder.id;
          chrome.bookmarks.create({ parentId: newFolder.id, title: "Add bookmarks here", url: "https://www.google.com" }, () => resolve());
        });
      });
    });
  }

  // ── Render Grid ─────────────────────
  async function renderGrid() {
    const fid = state.currentFolderId || state.quickDialId;
    if (!fid) return;

    const children = await new Promise(r => chrome.bookmarks.getChildren(fid, r));
    const items = children.filter(b => b.id !== state.quickDialId);

    const $grid = document.getElementById("grid");
    const $empty = document.getElementById("empty-state");

    $grid.innerHTML = "";

    if (items.length === 0) {
      $grid.hidden = true;
      $empty.hidden = false;
    } else {
      $grid.hidden = false;
      $empty.hidden = true;
      for (const item of items) $grid.appendChild(makeCard(item));
    }
    renderBreadcrumb();
  }

  // ── Favicon ─────────────────────────
  function makeFavicon(bookmark) {
    const img = document.createElement("img");
    img.className = "icon";
    img.draggable = false;
    img.loading = "lazy";
    try {
      img.src = "https://www.google.com/s2/favicons?domain=" + new URL(bookmark.url).hostname + "&sz=64";
    } catch { img.src = ""; }
    img.onerror = function() { this.style.display = "none"; };
    return img;
  }

  // ── Card ────────────────────────────
  function makeCard(bm) {
    const card = document.createElement("div");
    card.className = "card";
    card.dataset.id = bm.id;
    card.dataset.type = bm.type;
    card.draggable = true;

    if (bm.type === "folder") {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("class", "icon-folder");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.innerHTML = '<path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>';
      card.appendChild(svg);
    } else if (bm.url && !bm.url.startsWith("chrome://")) {
      card.appendChild(makeFavicon(bm));
    } else {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("class", "icon-folder");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.innerHTML = '<path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-1 7V3.5L18.5 9H13z"/>';
      card.appendChild(svg);
    }

    const title = document.createElement("div");
    title.className = "title";
    title.textContent = bm.title || "Untitled";
    card.appendChild(title);

    card.onclick = () => handleCardClick(bm);
    setupDrag(card, bm);
    card.oncontextmenu = (e) => { e.preventDefault(); showCtxMenu(e, bm); };

    return card;
  }

  function handleCardClick(bm) {
    if (bm.type === "folder") {
      state.navStack.push(state.currentFolderId);
      state.currentFolderId = bm.id;
      renderGrid();
    } else if (bm.url) {
      if (bm.url.startsWith("chrome://")) {
        navigator.clipboard.writeText(bm.url);
        showToast("URL copied");
      } else {
        chrome.tabs.create({ url: bm.url });
      }
    }
  }

  // ── Breadcrumb ──────────────────────
  function renderBreadcrumb() {
    const $bc = document.getElementById("breadcrumb");
    $bc.innerHTML = "";
    const path = [...state.navStack, state.currentFolderId];
    path.forEach((fid, i) => {
      if (i > 0) {
        const s = document.createElement("span");
        s.className = "separator";
        s.textContent = ">";
        $bc.appendChild(s);
      }
      const c = document.createElement("span");
      c.className = "crumb";
      c.textContent = fid === state.quickDialId ? "QuickDial" : "...";
      c.onclick = () => {
        state.currentFolderId = fid;
        state.navStack = path.slice(0, i);
        renderGrid();
      };
      $bc.appendChild(c);
    });
  }

  // ── Drag and Drop ───────────────────
  let dragId = null;

  function setupDragDrop() {
    document.addEventListener("dragover", (e) => {
      if (e.target.closest(".card")) e.preventDefault();
    }, false);
    document.addEventListener("drop", (e) => {
      if (e.target.closest(".card")) e.preventDefault();
    }, false);
  }

  function setupDrag(card, bm) {
    card.ondragstart = (e) => {
      dragId = bm.id;
      card.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
    };
    card.ondragend = () => {
      card.classList.remove("dragging");
      clearDropStyles();
      dragId = null;
    };
    card.ondragover = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const rect = card.getBoundingClientRect();
      const pos = e.clientY < rect.top + rect.height / 2 ? "above" : "below";
      clearDropStyles();
      card.classList.add(pos === "above" ? "drop-above" : "drop-below");
      if (bm.type === "folder") card.classList.add("drop-target");
    };
    card.ondragleave = (e) => {
      if (!card.contains(e.relatedTarget)) {
        card.classList.remove("drop-above", "drop-below", "drop-target");
      }
    };
    card.ondrop = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      clearDropStyles();
      if (!dragId || dragId === bm.id) return;

      try {
        const rect = card.getBoundingClientRect();
        const pos = e.clientY < rect.top + rect.height / 2 ? "above" : "below";

        if (bm.type === "folder") {
          await moveBm(dragId, bm.id, 0);
        } else {
          const kids = await getChildren();
          const idx = kids.findIndex(c => c.id === bm.id);
          const ni = pos === "above" ? Math.max(0, idx) : Math.min(kids.length, idx + 1);
          await moveBm(dragId, state.currentFolderId, ni);
        }
        await renderGrid();
      } catch (err) {
        console.error("Drag-drop error:", err);
      }
    };
  }

  function moveBm(id, parentId, index) {
    return new Promise((resolve, reject) => {
      chrome.bookmarks.move(id, { parentId: parentId, index: index }, () => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve();
      });
    });
  }

  async function getChildren() {
    return new Promise(r => chrome.bookmarks.getChildren(state.currentFolderId || state.quickDialId, r));
  }

  function clearDropStyles() {
    document.querySelectorAll(".card").forEach(c => c.classList.remove("drop-above", "drop-below", "drop-target"));
  }

  // ── Context Menu ────────────────────
  let ctxBm = null;

  function setupCtxMenu() {
    document.onclick = () => { document.getElementById("context-menu").hidden = true; };
    document.getElementById("context-menu").onclick = async (e) => {
      const act = e.target.closest("[data-action]");
      if (!act || !ctxBm) return;
      const id = ctxBm.id;
      switch (act.dataset.action) {
        case "open-newtab":
          if (ctxBm.url && !ctxBm.url.startsWith("chrome://")) chrome.tabs.create({ url: ctxBm.url });
          break;
        case "open-current":
          if (ctxBm.url) window.location.href = ctxBm.url;
          break;
        case "copy-url":
          if (ctxBm.url) { navigator.clipboard.writeText(ctxBm.url); showToast("URL copied"); }
          break;
        case "edit":
          const t = prompt("Rename:", ctxBm.title);
          if (t) { chrome.bookmarks.edit(id, { title: t }); renderGrid(); }
          break;
        case "delete":
          if (confirm("Delete this bookmark?")) { chrome.bookmarks.remove(id); renderGrid(); }
          break;
      }
      document.getElementById("context-menu").hidden = true;
    };
  }

  function showCtxMenu(e, bm) {
    ctxBm = bm;
    document.getElementById("context-menu").style.left = e.clientX + "px";
    document.getElementById("context-menu").style.top = e.clientY + "px";
    document.getElementById("context-menu").hidden = false;
  }

  // ── Toast ───────────────────────────
  function showToast(msg) {
    const t = document.createElement("div");
    t.textContent = msg;
    t.style.cssText = "position:fixed;bottom:2rem;left:50%;transform:translateX(-50%);background:#533483;color:#fff;padding:.6em 1.4em;border-radius:10px;font-size:.85rem;z-index:9999;";
    document.body.appendChild(t);
    setTimeout(() => { t.style.opacity = "0"; t.style.transition = "opacity .3s"; setTimeout(() => t.remove(), 300); }, 2000);
  }
})();
