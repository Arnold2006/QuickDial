/**
 * uptime-widget.js — QuickDial
 *
 * A small website uptime checker fixed below the TODO widget.
 *
 * - Each configured http/https URL is requested when a new tab opens and
 *   re-checked every minute while the tab stays open.
 * - A 2xx response is "UP"; a non-2xx response, timeout or network failure is
 *   "DOWN". The response time is shown in milliseconds.
 * - The Config panel adds or removes sites. The list is persisted in
 *   chrome.storage.local under "uptimeSites".
 * - Requests run only while the new tab is open; there is no background worker.
 */

'use strict';

(async function initUptimeWidget() {
  if (document.getElementById('uptime-widget')) return;

  const STORAGE_KEY    = 'uptimeSites';
  const CHECK_INTERVAL = 60_000; // 1 minute
  const CHECK_TIMEOUT  = 8_000;  // 8 seconds
  const WIDGET_GAP     = 12;     // px between TODO bottom and this widget

  let sites = await loadSites();
  let checkGeneration = 0;
  let checking = false;

  // ── Build DOM ───────────────────────────────────────────────────────────────

  const widget = document.createElement('section');
  widget.id = 'uptime-widget';
  widget.setAttribute('aria-label', 'Website uptime');
  widget.innerHTML = `
    <div class="uptime-header">
      <span class="uptime-title">UPTIME</span>
      <div class="uptime-header-actions">
        <button class="uptime-refresh" type="button"
                aria-label="Check sites now" title="Check sites now">↻</button>
        <button class="uptime-config-btn" type="button"
                aria-expanded="false" aria-controls="uptime-config-panel">Config</button>
      </div>
    </div>
    <ul class="uptime-list" role="list" aria-label="Configured websites"></ul>
    <p class="uptime-empty" hidden>No sites yet — open Config to add one.</p>
    <div class="uptime-config" id="uptime-config-panel" hidden>
      <form class="uptime-add-form">
        <input class="uptime-input" type="text" placeholder="https://example.com"
               aria-label="Website URL" autocomplete="off" spellcheck="false">
        <button class="uptime-add-btn" type="submit">Add</button>
      </form>
      <p class="uptime-form-error" role="status" hidden></p>
    </div>
  `;

  const listEl      = widget.querySelector('.uptime-list');
  const emptyEl     = widget.querySelector('.uptime-empty');
  const configPanel = widget.querySelector('.uptime-config');
  const configBtn   = widget.querySelector('.uptime-config-btn');
  const refreshBtn  = widget.querySelector('.uptime-refresh');
  const form        = widget.querySelector('.uptime-add-form');
  const input       = widget.querySelector('.uptime-input');
  const errorEl     = widget.querySelector('.uptime-form-error');

  // ── Rendering ───────────────────────────────────────────────────────────────

  function renderSites() {
    listEl.replaceChildren();
    for (const site of sites) listEl.appendChild(buildSiteRow(site));

    listEl.hidden = sites.length === 0;
    emptyEl.hidden = sites.length > 0;
    refreshBtn.disabled = sites.length === 0;

    if (sites.length === 0) {
      // Cancel any in-flight results for rows that no longer exist.
      checkGeneration++;
      checking = false;
    }
  }

  function buildSiteRow(site) {
    const li = document.createElement('li');
    li.className = 'uptime-item';
    li.dataset.site = site;
    li.dataset.status = 'checking';

    const dot = document.createElement('span');
    dot.className = 'uptime-dot';
    dot.dataset.state = 'checking';
    dot.setAttribute('aria-hidden', 'true');

    const name = document.createElement('span');
    name.className = 'uptime-name';
    name.textContent = displayName(site);
    name.title = site;

    const meta = document.createElement('span');
    meta.className = 'uptime-meta';
    meta.textContent = 'Checking…';

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'uptime-delete';
    del.textContent = '×';
    del.title = `Remove ${site}`;
    del.setAttribute('aria-label', `Remove ${site}`);
    del.addEventListener('click', () => removeSite(site));

    li.append(dot, name, meta, del);
    return li;
  }

  function setAllChecking() {
    for (const li of listEl.children) {
      li.dataset.status = 'checking';
      const dot = li.querySelector('.uptime-dot');
      const meta = li.querySelector('.uptime-meta');
      if (dot) dot.dataset.state = 'checking';
      if (meta) {
        meta.textContent = 'Checking…';
        meta.title = 'Checking…';
      }
    }
  }

  function applyResult(site, result) {
    const li = [...listEl.children].find(el => el.dataset.site === site);
    if (!li) return;

    const dot = li.querySelector('.uptime-dot');
    const meta = li.querySelector('.uptime-meta');
    if (!dot || !meta) return;

    if (result.state === 'up') {
      li.dataset.status = 'up';
      dot.dataset.state = 'up';
      meta.textContent = `UP ${result.status} · ${result.latency} ms`;
      meta.title = `HTTP ${result.status} in ${result.latency} ms`;
    } else if (result.state === 'timeout') {
      li.dataset.status = 'down';
      dot.dataset.state = 'down';
      meta.textContent = 'TIMEOUT';
      meta.title = `No response within ${CHECK_TIMEOUT / 1000} seconds`;
    } else if (result.status) {
      li.dataset.status = 'down';
      dot.dataset.state = 'down';
      meta.textContent = `DOWN ${result.status}`;
      meta.title = `HTTP ${result.status}${result.latency ? ` in ${result.latency} ms` : ''}`;
    } else {
      li.dataset.status = 'down';
      dot.dataset.state = 'down';
      meta.textContent = 'DOWN';
      meta.title = result.error || 'Request failed';
    }
  }

  // ── Checks ──────────────────────────────────────────────────────────────────

  async function checkAll(force = false) {
    if (checking && !force) return;
    if (sites.length === 0) {
      checkGeneration++;
      checking = false;
      return;
    }

    checking = true;
    const generation = ++checkGeneration;

    try {
      setAllChecking();

      await Promise.all(sites.map(async (site) => {
        const result = await checkSite(site);
        if (generation !== checkGeneration) return;
        applyResult(site, result);
      }));
    } catch (err) {
      console.error('[QuickDial] Uptime check failed:', err);
    } finally {
      if (generation === checkGeneration) checking = false;
    }
  }

  async function checkSite(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT);
    const started = performance.now();

    try {
      const response = await fetch(url, {
        method: 'GET',
        mode: 'cors',
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'follow',
        referrerPolicy: 'no-referrer',
        signal: controller.signal,
      });
      const latency = Math.round(performance.now() - started);

      // Only the status line is needed; don't download the whole page.
      try {
        if (response.body) response.body.cancel().catch(() => {});
      } catch {}

      return {
        state: response.ok ? 'up' : 'down',
        status: response.status,
        latency,
      };
    } catch (err) {
      if (err && err.name === 'AbortError') return { state: 'timeout' };
      return {
        state: 'down',
        error: err && err.message ? err.message : 'Request failed',
      };
    } finally {
      clearTimeout(timer);
    }
  }

  // ── Storage and config actions ──────────────────────────────────────────────

  async function loadSites() {
    try {
      const stored = await chrome.storage.local.get(STORAGE_KEY);
      const values = Array.isArray(stored[STORAGE_KEY]) ? stored[STORAGE_KEY] : [];
      const seen = new Set();
      const result = [];

      for (const value of values) {
        const url = normalizeUrl(value);
        if (url && !seen.has(url)) {
          seen.add(url);
          result.push(url);
        }
      }
      return result;
    } catch {
      return [];
    }
  }

  async function saveSites() {
    try {
      await chrome.storage.local.set({ [STORAGE_KEY]: sites });
      return true;
    } catch {
      showError('Could not save the list.');
      return false;
    }
  }

  async function removeSite(site) {
    const previous = sites;
    sites = sites.filter(item => item !== site);

    if (!(await saveSites())) {
      sites = previous;
      return;
    }

    renderSites();
    checkAll(true);
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const url = normalizeUrl(input.value);
    if (!url) {
      showError('Enter a valid http:// or https:// URL.');
      return;
    }
    if (sites.includes(url)) {
      showError('That site is already in the list.');
      return;
    }

    const previous = sites;
    sites = [...sites, url];

    if (!(await saveSites())) {
      sites = previous;
      return;
    }

    input.value = '';
    showError('');
    renderSites();
    checkAll(true);
    input.focus();
  });

  input.addEventListener('input', () => showError(''));

  function showError(message) {
    errorEl.textContent = message;
    errorEl.hidden = !message;
  }

  configBtn.addEventListener('click', () => {
    const open = !widget.classList.contains('config-open');
    widget.classList.toggle('config-open', open);
    configPanel.hidden = !open;
    configBtn.textContent = open ? 'Done' : 'Config';
    configBtn.setAttribute('aria-expanded', String(open));
    if (open) input.focus();
  });

  refreshBtn.addEventListener('click', () => checkAll());

  // ── Position below the TODO widget ─────────────────────────────────────────

  function positionWidget(todo) {
    widget.style.width = `${todo.offsetWidth || 240}px`;
    widget.style.top = `${Math.round(todo.getBoundingClientRect().bottom) + WIDGET_GAP}px`;
  }

  function whenElement(id, callback) {
    const existing = document.getElementById(id);
    if (existing) {
      callback(existing);
      return;
    }

    const observer = new MutationObserver(() => {
      const element = document.getElementById(id);
      if (element) {
        observer.disconnect();
        callback(element);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('beforeunload', () => observer.disconnect(), { once: true });
  }

  renderSites();

  whenElement('todo-widget', (todo) => {
    positionWidget(todo);
    document.body.appendChild(widget);

    const resizeObserver = new ResizeObserver(() => positionWidget(todo));
    resizeObserver.observe(todo);

    const styleObserver = new MutationObserver(() => positionWidget(todo));
    styleObserver.observe(todo, { attributes: true, attributeFilter: ['style'] });

    window.addEventListener('beforeunload', () => {
      resizeObserver.disconnect();
      styleObserver.disconnect();
    }, { once: true });

    checkAll();

    const intervalId = setInterval(() => checkAll(), CHECK_INTERVAL);
    window.addEventListener('beforeunload', () => clearInterval(intervalId), { once: true });
  });

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function normalizeUrl(raw) {
    let value = String(raw ?? '').trim();
    if (!value) return null;

    // A bare hostname is treated as https.
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
      value = `https://${value}`;
    }

    try {
      const url = new URL(value);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
      if (!url.hostname || url.username || url.password) return null;
      url.hash = '';
      return url.href;
    } catch {
      return null;
    }
  }

  function displayName(site) {
    try {
      const url = new URL(site);
      const path = url.pathname && url.pathname !== '/' ? url.pathname : '';
      return `${url.host}${path}`;
    } catch {
      return site;
    }
  }
})();
