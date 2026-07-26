/**
 * clock-widget.js — QuickDial
 *
 * Creates a digital clock widget fixed in the top-right corner of the page.
 *
 * Features
 * ────────
 * - Displays HH:MM:SS on one line, long date on the next.
 * - "Resize-drag logic": drag the bottom-right corner handle to resize.
 *   Width and height are clamped to sensible min/max values.
 *   Font sizes scale proportionally via the CSS custom property --clock-scale.
 * - Widget size is persisted across browser sessions via chrome.storage.local.
 * - The setInterval is cleaned up on page unload to avoid memory leaks.
 */

'use strict';

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULTS = { width: 220, height: 110 };
const LIMITS   = { minW: 160, maxW: 520, minH: 80, maxH: 280 };

// ── Bootstrap (IIFE so we don't pollute the global scope) ─────────────────────

(async function initClockWidget() {
  // Load persisted size from a previous session.
  const stored = await chrome.storage.local.get(['clockWidth', 'clockHeight']);
  const initW  = typeof stored.clockWidth  === 'number' ? stored.clockWidth  : DEFAULTS.width;
  const initH  = typeof stored.clockHeight === 'number' ? stored.clockHeight : DEFAULTS.height;

  // ── Build DOM ───────────────────────────────────────────────────────────────
  const widget = document.createElement('div');
  widget.id = 'clock-widget';
  widget.setAttribute('aria-label', 'Clock');
  widget.innerHTML = `
    <div class="clock-time" id="clock-time" aria-live="off"></div>
    <div class="clock-date" id="clock-date"></div>
    <div class="clock-resize-handle"
         id="clock-resize-handle"
         aria-hidden="true"
         title="Drag to resize"></div>
  `;
  document.body.appendChild(widget);

  // Apply the initial (possibly persisted) size.
  applySize(widget, initW, initH);

  // ── Clock tick ──────────────────────────────────────────────────────────────
  const timeEl = widget.querySelector('#clock-time');
  const dateEl = widget.querySelector('#clock-date');

  function tick() {
    const now = new Date();
    const hh  = String(now.getHours()).padStart(2, '0');
    const mm  = String(now.getMinutes()).padStart(2, '0');
    const ss  = String(now.getSeconds()).padStart(2, '0');
    timeEl.textContent = `${hh}:${mm}:${ss}`;
    dateEl.textContent = now.toLocaleDateString(undefined, {
      weekday: 'long',
      year:    'numeric',
      month:   'long',
      day:     'numeric',
    });
  }

  tick(); // immediate first render — no visible flash
  const intervalId = setInterval(tick, 1000);

  // Clean up the interval when the tab is closed / navigated away from.
  window.addEventListener('beforeunload', () => clearInterval(intervalId));

  // ── Resize-drag logic ───────────────────────────────────────────────────────
  const handle = widget.querySelector('#clock-resize-handle');

  let dragging = false;
  let dragStartX, dragStartY, dragStartW, dragStartH;

  handle.addEventListener('mousedown', (e) => {
    dragging    = true;
    dragStartX  = e.clientX;
    dragStartY  = e.clientY;
    dragStartW  = widget.offsetWidth;
    dragStartH  = widget.offsetHeight;
    // Prevent text selection on the page while dragging.
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const newW = clamp(dragStartW + (e.clientX - dragStartX), LIMITS.minW, LIMITS.maxW);
    const newH = clamp(dragStartH + (e.clientY - dragStartY), LIMITS.minH, LIMITS.maxH);
    applySize(widget, newW, newH);
  });

  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    document.body.style.userSelect = '';
    // Persist the new size so it survives the next new-tab open.
    chrome.storage.local.set({
      clockWidth:  widget.offsetWidth,
      clockHeight: widget.offsetHeight,
    });
  });
})();

// ── Utilities ─────────────────────────────────────────────────────────────────

/**
 * Sets the widget's width and height and updates the CSS custom property
 * --clock-scale so that font sizes scale proportionally with width.
 * At the default width (220 px) scale = 1.0.
 */
function applySize(widget, w, h) {
  widget.style.width  = `${w}px`;
  widget.style.height = `${h}px`;
  const scale = (w / DEFAULTS.width).toFixed(3);
  widget.style.setProperty('--clock-scale', scale);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
