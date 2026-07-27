/**
 * todo-widget.js — QuickDial
 *
 * A markdown-style TODO list widget fixed below the clock widget.
 *
 * Features
 * ────────
 * - Items are stored and displayed in standard markdown checklist syntax:
 *     - [ ] pending task
 *     - [x] completed task
 * - The "- [ ]" / "- [x]" prefix is a clickable toggle button (monospace,
 *   code-style) so the markdown syntax itself is the interactive element.
 * - Task text is editable inline (contenteditable span).
 * - New items can be entered as plain text or full markdown syntax
 *   (e.g. "- [ ] Buy milk" or simply "Buy milk").
 * - Resize-drag logic identical to the clock widget (bottom-right handle).
 * - Widget size and markdown content are persisted in chrome.storage.local.
 * - Automatically positions itself below the clock widget, tracking clock
 *   height changes via ResizeObserver.
 * - The setInterval / observers are cleaned up on page unload.
 */

'use strict';

// ── Constants ─────────────────────────────────────────────────────────────────

const TODO_DEFAULTS = { width: 240, height: 280 };
const TODO_LIMITS   = { minW: 180, maxW: 520, minH: 120, maxH: 600 };
const CLOCK_GAP     = 12; // px between clock bottom and todo top

// ── Markdown helpers ──────────────────────────────────────────────────────────

/** Parse a markdown checklist string into an array of { text, done } objects. */
function parseMarkdown(md) {
  if (!md || !md.trim()) return [];
  return md.split('\n')
    .map(line => line.match(/^- \[([ xX])\] (.+)$/))
    .filter(Boolean)
    .map(m => ({ done: m[1].toLowerCase() === 'x', text: m[2] }));
}

/** Serialize an array of { text, done } objects back to a markdown string. */
function serializeItems(items) {
  return items.map(it => `- [${it.done ? 'x' : ' '}] ${it.text}`).join('\n');
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

(async function initTodoWidget() {
  const stored = await chrome.storage.local.get(['todoMarkdown', 'todoWidth', 'todoHeight']);
  const initW  = typeof stored.todoWidth  === 'number' ? stored.todoWidth  : TODO_DEFAULTS.width;
  const initH  = typeof stored.todoHeight === 'number' ? stored.todoHeight : TODO_DEFAULTS.height;
  let items    = parseMarkdown(stored.todoMarkdown || '');

  // ── Build DOM ───────────────────────────────────────────────────────────────

  const widget = document.createElement('div');
  widget.id = 'todo-widget';
  widget.setAttribute('aria-label', 'TODO list');

  const header = document.createElement('div');
  header.className = 'todo-header';
  header.textContent = 'TODO';

  const list = document.createElement('ul');
  list.className = 'todo-list';
  list.setAttribute('role', 'list');

  const addRow = document.createElement('div');
  addRow.className = 'todo-add-row';

  const addInput = document.createElement('input');
  addInput.type = 'text';
  addInput.className = 'todo-input';
  addInput.placeholder = '- [ ] Add task…';
  addInput.setAttribute('aria-label', 'New task');

  const addBtn = document.createElement('button');
  addBtn.className = 'todo-add-btn';
  addBtn.setAttribute('aria-label', 'Add task');
  addBtn.textContent = '+';

  const resizeHandle = document.createElement('div');
  resizeHandle.className = 'todo-resize-handle';
  resizeHandle.setAttribute('aria-hidden', 'true');
  resizeHandle.title = 'Drag to resize';

  addRow.appendChild(addInput);
  addRow.appendChild(addBtn);
  widget.appendChild(header);
  widget.appendChild(list);
  widget.appendChild(addRow);
  widget.appendChild(resizeHandle);
  document.body.appendChild(widget);

  applyTodoSize(widget, initW, initH);
  renderItems();

  // ── Position below clock ────────────────────────────────────────────────────

  function positionBelowClock() {
    const cw   = document.getElementById('clock-widget');
    const top  = cw ? cw.getBoundingClientRect().bottom + CLOCK_GAP : 160;
    widget.style.top = `${top}px`;
  }

  function attachClockObserver(cw) {
    positionBelowClock();
    new ResizeObserver(positionBelowClock).observe(cw);
  }

  const clockEl = document.getElementById('clock-widget');
  if (clockEl) {
    attachClockObserver(clockEl);
  } else {
    positionBelowClock();
    const obs = new MutationObserver(() => {
      const found = document.getElementById('clock-widget');
      if (found) { obs.disconnect(); attachClockObserver(found); }
    });
    obs.observe(document.body, { childList: true });
    window.addEventListener('beforeunload', () => obs.disconnect(), { once: true });
  }

  // ── Render items ─────────────────────────────────────────────────────────────

  function renderItems() {
    list.innerHTML = '';

    items.forEach((item, idx) => {
      const li = document.createElement('li');
      li.className = 'todo-item' + (item.done ? ' todo-done' : '');

      // The markdown toggle prefix — clicking it toggles [ ] ↔ [x].
      const toggle = document.createElement('button');
      toggle.className = 'todo-md-toggle';
      toggle.setAttribute('aria-label', item.done ? 'Mark as pending' : 'Mark as done');
      toggle.setAttribute('aria-pressed', String(item.done));
      toggle.textContent = item.done ? '- [x]' : '- [ ]';
      toggle.addEventListener('click', () => {
        item.done = !item.done;
        toggle.textContent = item.done ? '- [x]' : '- [ ]';
        toggle.setAttribute('aria-pressed', String(item.done));
        toggle.setAttribute('aria-label', item.done ? 'Mark as pending' : 'Mark as done');
        li.classList.toggle('todo-done', item.done);
        save();
      });

      // Inline-editable task text.
      const span = document.createElement('span');
      span.className = 'todo-text';
      span.contentEditable = 'true';
      span.spellcheck = false;
      span.textContent = item.text;

      span.addEventListener('paste', e => {
        e.preventDefault();
        const plain = (e.clipboardData || window.clipboardData)
          .getData('text/plain').replace(/[\r\n]+/g, ' ').trim();
        document.execCommand('insertText', false, plain);
      });

      span.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); span.blur(); }
      });

      span.addEventListener('blur', () => {
        const t = span.textContent.trim();
        if (t) {
          item.text = t;
          save();
        } else {
          // Remove the item if the text was cleared.
          items.splice(idx, 1);
          save();
          renderItems();
        }
      });

      const delBtn = document.createElement('button');
      delBtn.className = 'todo-delete-btn';
      delBtn.setAttribute('aria-label', 'Delete task');
      delBtn.title = 'Delete';
      delBtn.textContent = '×';
      delBtn.addEventListener('click', () => {
        items.splice(idx, 1);
        save();
        renderItems();
      });

      li.appendChild(toggle);
      li.appendChild(span);
      li.appendChild(delBtn);
      list.appendChild(li);
    });
  }

  // ── Add item ──────────────────────────────────────────────────────────────────

  function addItem() {
    const raw = addInput.value.trim();
    if (!raw) return;

    // Accept full markdown syntax ("- [ ] text" / "- [x] text") or plain text.
    const mdMatch = raw.match(/^-\s*\[([ xX])\]\s+(.+)$/);
    if (mdMatch) {
      items.push({ done: mdMatch[1].toLowerCase() === 'x', text: mdMatch[2].trim() });
    } else {
      items.push({ done: false, text: raw });
    }

    save();
    renderItems();
    addInput.value = '';
    addInput.focus();
  }

  addBtn.addEventListener('click', addItem);
  addInput.addEventListener('keydown', e => { if (e.key === 'Enter') addItem(); });

  function save() {
    chrome.storage.local.set({ todoMarkdown: serializeItems(items) });
  }

  // ── Resize-drag logic ─────────────────────────────────────────────────────────

  let dragging = false;
  let dragStartX, dragStartY, dragStartW, dragStartH;

  resizeHandle.addEventListener('mousedown', e => {
    dragging   = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    dragStartW = widget.offsetWidth;
    dragStartH = widget.offsetHeight;
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });

  const onMouseMove = e => {
    if (!dragging) return;
    const newW = todoClamp(dragStartW + (e.clientX - dragStartX), TODO_LIMITS.minW, TODO_LIMITS.maxW);
    const newH = todoClamp(dragStartH + (e.clientY - dragStartY), TODO_LIMITS.minH, TODO_LIMITS.maxH);
    applyTodoSize(widget, newW, newH);
  };

  const onMouseUp = () => {
    if (!dragging) return;
    dragging = false;
    document.body.style.userSelect = '';
    chrome.storage.local.set({ todoWidth: widget.offsetWidth, todoHeight: widget.offsetHeight });
  };

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
  window.addEventListener('beforeunload', () => {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  }, { once: true });
})();

// ── Utilities ─────────────────────────────────────────────────────────────────

/**
 * Sets the widget's width and height and updates --todo-scale so that font
 * sizes scale proportionally with width (scale 1.0 at default width).
 */
function applyTodoSize(widget, w, h) {
  widget.style.width  = `${w}px`;
  widget.style.height = `${h}px`;
  widget.style.setProperty('--todo-scale', (w / TODO_DEFAULTS.width).toFixed(3));
}

function todoClamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
