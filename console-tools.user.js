// ==UserScript==
// @name         Console Tools
// @namespace    almas-apps
// @version      1.4.0
// @description  Floating gear menu of Play Console utilities. Bump @version on every change so Tampermonkey picks it up.
// @updateURL    http://localhost:8765/console-tools.user.js
// @downloadURL  http://localhost:8765/console-tools.user.js
// @match        https://play.google.com/console/*
// @grant        none
// @noframes
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // Country tiers for regional pricing (docs/PRICING.md in the namaz repo).
  // The script only selects rows; the price is whatever you type after "Set price".
  // Names must match the Console's row labels exactly (e.g. "Czechia").
  // Tier 2 is "every country not in Tier 1", computed from the table.
  const TIER_1 = [
    'Australia', 'Austria', 'Bahrain', 'Belgium', 'Bermuda',
    'British Virgin Islands', 'Bulgaria', 'Canada', 'Cayman Islands', 'Croatia',
    'Cyprus', 'Czechia', 'Denmark', 'Estonia', 'Finland', 'France', 'Germany',
    'Gibraltar', 'Greece', 'Hong Kong', 'Hungary', 'Iceland', 'Ireland', 'Italy',
    'Japan', 'Kuwait', 'Latvia', 'Liechtenstein', 'Lithuania', 'Luxembourg',
    'Macao', 'Malta', 'Monaco', 'Netherlands', 'New Zealand', 'Norway', 'Oman',
    'Poland', 'Portugal', 'Qatar', 'Romania', 'San Marino', 'Saudi Arabia',
    'Singapore', 'Slovakia', 'Slovenia', 'South Korea', 'Spain', 'Sweden',
    'Switzerland', 'Taiwan', 'Turks & Caicos Islands', 'United Arab Emirates',
    'United Kingdom', 'United States', 'Vatican City',
  ];

  // The button that puts the table into row-selection mode. Its inner
  // <div class="mdc-button__touch"> is what gets clicked. Only used when no row
  // checkboxes are on screen yet.
  const ENTRY_BUTTON = /update exchange rates|edit prices|set prices/i;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const rowBoxes = () =>
    [...document.querySelectorAll('mat-checkbox[aria-label]')].filter(
      (b) => b.getAttribute('aria-label') !== 'Select all rows'
    );

  const findBox = (name) =>
    rowBoxes().find((b) => b.getAttribute('aria-label') === name);

  const isChecked = (b) => b.getAttribute('aria-checked') === 'true';

  // The Console's checkbox is a custom component (`delegate-events`) that ignores a
  // bare scripted .click(). Fire a real pointer/mouse sequence at its centre, try
  // each target in turn, and stop as soon as aria-checked actually flips. Last
  // resort is the keyboard: focus it and press Space.
  function fire(el, type, x, y) {
    const opts = { bubbles: true, cancelable: true, composed: true, view: window,
                   clientX: x, clientY: y, button: 0, buttons: 1 };
    const E = type.startsWith('pointer') ? PointerEvent : MouseEvent;
    el.dispatchEvent(new E(type, type.startsWith('pointer')
      ? { ...opts, pointerId: 1, pointerType: 'mouse', isPrimary: true } : opts));
  }

  function realClick(el) {
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    for (const t of ['pointerover', 'pointerenter', 'mouseover', 'pointerdown',
                     'mousedown', 'pointerup', 'mouseup', 'click']) fire(el, t, x, y);
  }

  // Poll briefly for the flip instead of a fixed wait: it usually lands in one frame.
  async function flipped(b, before, ms = 120) {
    for (let t = 0; t < ms; t += 10) {
      if (isChecked(b) !== before) return true;
      await sleep(10);
    }
    return isChecked(b) !== before;
  }

  // Remember which target worked so later boxes try it first.
  let bestTarget = 0;

  async function clickBox(b) {
    const before = isChecked(b);
    const r = b.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight) b.scrollIntoView({ block: 'center' });
    const targets = [b.querySelector('.mat-checkbox-container'), b,
                     b.querySelector('svg'), b.closest('ess-cell')];
    const order = [bestTarget, ...targets.keys()].filter((v, i, a) => a.indexOf(v) === i);
    for (const i of order) {
      if (!targets[i]) continue;
      realClick(targets[i]);
      if (await flipped(b, before)) { bestTarget = i; return true; }
    }
    b.focus();
    for (const type of ['keydown', 'keyup']) {
      b.dispatchEvent(new KeyboardEvent(type, { key: ' ', code: 'Space', keyCode: 32,
                                                bubbles: true, cancelable: true }));
    }
    await sleep(60);
    return isChecked(b) !== before;
  }

  async function enterSelectionMode() {
    if (rowBoxes().length) return true;
    const btn = [...document.querySelectorAll('button.mdc-button')].find((b) =>
      ENTRY_BUTTON.test(b.textContent)
    );
    if (!btn) return false;
    (btn.querySelector('.mdc-button__touch') || btn).click();
    for (let i = 0; i < 20 && !rowBoxes().length; i++) await sleep(150);
    return rowBoxes().length > 0;
  }

  // Iceland, Malta and others can sit inside the collapsed
  // "Other countries / regions (USD|EUR)" groups.
  async function expandGroups() {
    const zippies = document.querySelectorAll(
      'button.zippy-button[aria-expanded="false"]'
    );
    zippies.forEach((z) => (z.querySelector('.mdc-icon-button__touch') || z).click());
    if (zippies.length) await sleep(400);
  }

  // Group header rows ("Other countries / regions (USD)") are not countries.
  const isGroup = (name) => /^Other countries/i.test(name);
  const labelOf = (b) => b.getAttribute('aria-label');

  async function prepare() {
    if (!(await enterSelectionMode())) {
      say('No price table found. Open the base plan\'s price editor first.', true);
      return false;
    }
    await expandGroups();
    return true;
  }

  // Ticks every box in the tier; if they are all already ticked, unticks them.
  async function toggleBoxes(name, boxes, missing = []) {
    const allOn = boxes.length > 0 && boxes.every(isChecked);
    const stuck = [];
    for (const b of boxes) {
      if (isChecked(b) === allOn && !(await clickBox(b))) stuck.push(labelOf(b));
    }

    const on = boxes.filter(isChecked).length;
    let msg = allOn
      ? `${name}: unticked ${boxes.length}.`
      : `${name}: ${on} of ${boxes.length + missing.length} ticked. Press "Set price" to price them.`;
    if (missing.length) msg += `\nNot found: ${missing.join(', ')}`;
    if (stuck.length) msg += `\nWould not toggle (${stuck.length}): ${stuck.slice(0, 8).join(', ')}${stuck.length > 8 ? '…' : ''}`;
    say(msg, missing.length > 0 || stuck.length > 0);
  }

  async function toggleTier1() {
    if (!(await prepare())) return;
    const found = TIER_1.map((n) => [n, findBox(n)]);
    const missing = found.filter(([, b]) => !b).map(([n]) => n);
    await toggleBoxes('Tier 1', found.filter(([, b]) => b).map(([, b]) => b), missing);
  }

  async function toggleTier2() {
    if (!(await prepare())) return;
    const t1 = new Set(TIER_1);
    const boxes = rowBoxes().filter((b) => !t1.has(labelOf(b)) && !isGroup(labelOf(b)));
    await toggleBoxes('Tier 2', boxes);
  }

  async function clearAll() {
    if (!(await prepare())) return;
    const on = rowBoxes().filter(isChecked);
    for (const b of on) await clickBox(b);
    say(`Cleared ${on.length} selections.`);
  }

  // --- UI ---------------------------------------------------------------

  let toastTimer;
  function say(text, warn) {
    let t = document.getElementById('almas-tier-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'almas-tier-toast';
      Object.assign(t.style, {
        position: 'fixed', right: '92px', bottom: '100px', zIndex: 2147483647,
        maxWidth: '360px', padding: '10px 14px', borderRadius: '8px',
        font: '13px/1.4 system-ui, sans-serif', whiteSpace: 'pre-wrap',
        boxShadow: '0 4px 16px rgba(0,0,0,.25)', color: '#fff',
      });
      document.body.appendChild(t);
    }
    t.textContent = text;
    t.style.background = warn ? '#b3261e' : '#1a73e8';
    t.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.style.display = 'none'), warn ? 12000 : 5000);
  }

  // Each tool is one menu row. Add new utilities here.
  const TOOLS = [
    {
      label: `Tier 1 (${TIER_1.length} countries)`,
      hint: 'Tick / untick the high-income countries',
      run: toggleTier1,
    },
    {
      label: 'Tier 2 (everyone else)',
      hint: 'Tick / untick every country not in Tier 1',
      run: toggleTier2,
    },
    {
      label: 'Clear selection',
      hint: 'Untick every row',
      run: clearAll,
    },
  ];

  function toggleMenu() {
    let m = document.getElementById('almas-tools-menu');
    if (m) return m.remove();
    m = document.createElement('div');
    m.id = 'almas-tools-menu';
    Object.assign(m.style, {
      position: 'fixed', right: '20px', bottom: '168px', zIndex: 2147483647,
      minWidth: '260px', padding: '6px 0', borderRadius: '10px',
      background: '#fff', color: '#202124', font: '13px/1.4 system-ui, sans-serif',
      boxShadow: '0 6px 24px rgba(0,0,0,.25)',
    });
    for (const t of TOOLS) {
      const row = document.createElement('button');
      Object.assign(row.style, {
        display: 'block', width: '100%', textAlign: 'left', padding: '8px 14px',
        border: 'none', background: 'none', cursor: 'pointer', font: 'inherit',
      });
      // No innerHTML anywhere: the Console enforces Trusted Types, and a single
      // innerHTML assignment throws and kills the whole script silently.
      const title = document.createElement('div');
      title.style.fontWeight = '600';
      title.textContent = t.label;
      const hint = document.createElement('div');
      Object.assign(hint.style, { color: '#5f6368', fontSize: '12px' });
      hint.textContent = t.hint;
      row.append(title, hint);
      row.onmouseenter = () => (row.style.background = '#f1f3f4');
      row.onmouseleave = () => (row.style.background = 'none');
      row.onclick = () => {
        m.remove();
        Promise.resolve(t.run()).catch((e) => say('Error: ' + e.message, true));
      };
      m.appendChild(row);
    }
    document.body.appendChild(m);
  }

  function mountGear() {
    if (document.getElementById('almas-tools-gear')) return;
    const g = document.createElement('button');
    g.id = 'almas-tools-gear';
    g.title = 'Console Tools';
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '32');
    svg.setAttribute('height', '32');
    svg.setAttribute('fill', 'currentColor');
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', 'M19.14 12.94a7.07 7.07 0 0 0 0-1.88l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.03 7.03 0 0 0-1.63-.94l-.36-2.54A.5.5 0 0 0 13.9 2h-3.8a.5.5 0 0 0-.49.42l-.36 2.54c-.59.24-1.13.56-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.71 8.48a.5.5 0 0 0 .12.64l2.03 1.58a7.07 7.07 0 0 0 0 1.88l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.13.22.39.3.6.22l2.39-.96c.5.38 1.04.7 1.63.94l.36 2.54c.05.24.25.42.49.42h3.8c.24 0 .45-.18.49-.42l.36-2.54c.59-.24 1.13-.56 1.63-.94l2.39.96c.22.08.47 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7Z');
    svg.appendChild(path);
    g.appendChild(svg);
    Object.assign(g.style, {
      position: 'fixed', right: '20px', bottom: '96px', zIndex: 2147483647,
      width: '60px', height: '60px', borderRadius: '50%', border: 'none',
      background: '#1a73e8', color: '#fff', cursor: 'pointer',
      display: 'grid', placeItems: 'center',
      boxShadow: '0 4px 12px rgba(0,0,0,.3)', opacity: '.85',
    });
    g.onmouseenter = () => (g.style.opacity = '1');
    g.onmouseleave = () => (g.style.opacity = '.85');
    g.onclick = toggleMenu;
    document.body.appendChild(g);
  }

  // The Console is a single-page app, so keep the gear alive across navigation.
  const safeMount = () => {
    try { mountGear(); } catch (e) { console.error('[Console Tools]', e); }
  };
  safeMount();
  new MutationObserver(safeMount).observe(document.body, { childList: true });
  console.info('[Console Tools] loaded');
})();
