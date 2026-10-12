// ==UserScript==
// @name         Console Tools
// @namespace    almas-apps
// @version      1.7.0
// @description  Floating gear menu of Play Console utilities. Bump @version on every change so Tampermonkey picks it up.
// @updateURL    http://localhost:8765/console-tools.user.js
// @downloadURL  http://localhost:8765/console-tools.user.js
// @match        https://play.google.com/console/*
// @grant        GM_xmlhttpRequest
// @connect      open.er-api.com
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
    const opts = { bubbles: true, cancelable: true, composed: true,
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

  // --- Order management ---------------------------------------------------
  //
  // Read-only: the Console's table is left alone apart from hiding test rows.
  // License-tester orders show "Test: " in front of the product name.
  //
  // Every order that passes through the table (any page, sort or search) is
  // remembered until reload, so the stats cover everything you've paged through.

  const HOME_CURRENCY = 'CAD';
  // Free, no key, covers GHS/PHP etc. Fetched through GM_xmlhttpRequest so the
  // Console's CSP can't block it. Cached for 12 hours.
  const RATES_URL = `https://open.er-api.com/v6/latest/${HOME_CURRENCY}`;
  const RATES_KEY = 'almas-fx-' + HOME_CURRENCY;
  const TEST_KEY = 'almas-hide-test-orders';
  const OVERLAY_KEY = 'almas-orders-overlay';

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  };

  let hideTests = store.get(TEST_KEY) === '1';
  let showOverlay = store.get(OVERLAY_KEY) === '1';

  let rates = null, ratesDate = '', ratesTried = false;
  function loadRates() {
    if (rates || ratesTried) return;
    ratesTried = true;
    try {
      const c = JSON.parse(store.get(RATES_KEY) || 'null');
      if (c && Date.now() - c.at < 12 * 3600e3) { rates = c.rates; ratesDate = c.date; return; }
    } catch (e) {}
    if (typeof GM_xmlhttpRequest !== 'function') return;
    GM_xmlhttpRequest({
      method: 'GET', url: RATES_URL,
      onload: (r) => {
        try {
          const j = JSON.parse(r.responseText);
          if (j.result !== 'success') return;
          rates = j.rates;
          ratesDate = (j.time_last_update_utc || '').slice(5, 16);
          store.set(RATES_KEY, JSON.stringify({ at: Date.now(), rates, date: ratesDate }));
          scheduleOrders();
        } catch (e) {}
      },
    });
  }

  const orderPage = () => document.querySelector('orders-list-page');
  const orderRows = () =>
    [...document.querySelectorAll('orders-list-page .particle-table-row')];
  const cellText = (row, field) =>
    row.querySelector(`ess-cell[essfield="${field}"] .main-text`)?.textContent.trim() || '';
  const orderId = (row) =>
    row.querySelector('ess-cell[essfield="order_id_column"]')?.textContent.trim() || '';
  const isTestRow = (row) => /^Test:/i.test(cellText(row, 'product_column'));

  // order id -> { test, currency, amount, product }
  const seen = new Map();

  function collect() {
    for (const r of orderRows()) {
      const id = orderId(r);
      if (!id) continue;
      const m = cellText(r, 'total_column').match(/^([A-Z]{3})\s*([\d.,]+)/);
      seen.set(id, {
        test: isTestRow(r),
        currency: m ? m[1] : '',
        amount: m ? parseFloat(m[2].replace(/,/g, '')) : 0,
        product: cellText(r, 'product_column').replace(/\s*\(.*\)$/, ''),
      });
    }
  }

  function applyOrderFilter() {
    for (const row of orderRows()) {
      const hide = hideTests && isTestRow(row);
      if ((row.style.display === 'none') !== hide) row.style.display = hide ? 'none' : '';
    }
  }

  function summarize() {
    const sums = {}, products = {};
    let tests = 0, real = 0, paid = 0;
    for (const o of seen.values()) {
      if (o.test) { tests++; continue; }
      real++;
      // Refunded orders show a 0.00 total, so "paid" is simply total > 0.
      if (o.amount > 0) {
        paid++;
        sums[o.currency] = (sums[o.currency] || 0) + o.amount;
        products[o.product] = (products[o.product] || 0) + 1;
      }
    }
    let home = 0;
    const unconverted = [];
    for (const [c, v] of Object.entries(sums)) {
      if (c === HOME_CURRENCY) home += v;
      else if (rates?.[c]) home += v / rates[c];
      else unconverted.push(c);
    }
    return { total: seen.size, tests, real, paid, sums, products, home, unconverted };
  }

  const el = (tag, style, text) => {
    const e = document.createElement(tag);
    if (style) Object.assign(e.style, style);
    if (text != null) e.textContent = text;
    return e;
  };

  // The stats block, shared by the overlay and the gear menu.
  function statsBlock() {
    const s = summarize();
    const muted = { color: '#5f6368', fontSize: '12px' };
    const box = el('div');
    const head = el('div', { display: 'flex', alignItems: 'baseline', gap: '8px' });
    head.append(
      el('div', { fontSize: '24px', fontWeight: '700', color: '#137333' }, String(s.paid)),
      el('div', { fontWeight: '600' }, s.paid === 1 ? 'real purchase' : 'real purchases'),
    );
    box.append(head, el('div', muted,
      `${s.total} orders seen · ${s.tests} test · ${s.real - s.paid} refunded`));
    if (s.paid) {
      box.append(el('div', { fontSize: '17px', fontWeight: '600', marginTop: '6px' },
        `≈ ${HOME_CURRENCY} ${s.home.toFixed(2)}`));
      if (s.unconverted.length) {
        box.append(el('div', { ...muted, color: '#b3261e' },
          (rates ? 'No rate for ' : 'Rates unavailable, not in total: ') + s.unconverted.join(', ')));
      }
      box.append(el('div', muted,
        Object.entries(s.sums).map(([c, v]) => `${c} ${v.toFixed(2)}`).join(' · ')));
      const list = el('div', { marginTop: '4px' });
      for (const [p, n] of Object.entries(s.products).sort((a, b) => b[1] - a[1])) {
        list.append(el('div', null, `${n}× ${p}`));
      }
      box.append(list);
    }
    box.append(el('div', { ...muted, fontSize: '11px', marginTop: '6px' },
      'Counts every page you\'ve viewed since reload. Gross, before Google\'s fee' +
      (ratesDate ? ` · rates ${ratesDate}` : '') + '.'));
    return { box, key: JSON.stringify([s, !!rates]) };
  }

  let overlayKey = '';
  function renderOverlay() {
    let o = document.getElementById('almas-orders-overlay');
    if (!showOverlay || !orderPage()) { o?.remove(); overlayKey = ''; return; }
    const { box, key } = statsBlock();
    if (o && key === overlayKey) return;
    overlayKey = key;
    if (!o) {
      o = el('div', {
        position: 'fixed', right: '20px', top: '140px', zIndex: 2147483646,
        width: '260px', padding: '12px 14px', borderRadius: '12px',
        background: '#fff', color: '#202124', font: '13px/1.45 system-ui, sans-serif',
        boxShadow: '0 6px 24px rgba(0,0,0,.22)', pointerEvents: 'none',
      });
      o.id = 'almas-orders-overlay';
      document.body.appendChild(o);
    }
    o.replaceChildren(box);
  }

  function setHideTests(on) {
    hideTests = on;
    store.set(TEST_KEY, on ? '1' : '0');
    applyOrderFilter();
    if (!orderPage()) say(`Test orders will be ${on ? 'hidden' : 'shown'} on Order management.`);
  }

  function setOverlay(on) {
    showOverlay = on;
    store.set(OVERLAY_KEY, on ? '1' : '0');
    renderOverlay();
    if (!orderPage()) say(`Purchase overlay ${on ? 'on' : 'off'}. It shows on Order management.`);
  }

  function ordersTick() {
    if (orderPage()) {
      loadRates();
      collect();
      applyOrderFilter();
    }
    renderOverlay();
  }

  let ordersPending = 0;
  function scheduleOrders() {
    if (ordersPending) return;
    ordersPending = requestAnimationFrame(() => { ordersPending = 0; ordersTick(); });
  }

  new MutationObserver((muts) => {
    // Ignore our own overlay redraws, or every redraw would schedule another.
    if (muts.every((m) => m.target.closest?.('#almas-orders-overlay'))) return;
    scheduleOrders();
  }).observe(document.body, { childList: true, subtree: true, characterData: true });

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
    {
      label: 'Hide test orders',
      get active() { return hideTests; },
      hint: 'Order management: only real purchases',
      run: () => setHideTests(!hideTests),
    },
    {
      label: 'Purchase overlay',
      get active() { return showOverlay; },
      hint: 'Keep the purchase stats on screen',
      run: () => setOverlay(!showOverlay),
    },
  ];

  function toggleMenu() {
    let m = document.getElementById('almas-tools-menu');
    if (m) return m.remove();
    m = document.createElement('div');
    m.id = 'almas-tools-menu';
    Object.assign(m.style, {
      position: 'fixed', right: '20px', bottom: '168px', zIndex: 2147483647,
      width: '290px', padding: '6px 0', borderRadius: '10px',
      maxHeight: 'calc(100vh - 200px)', overflowY: 'auto',
      background: '#fff', color: '#202124', font: '13px/1.4 system-ui, sans-serif',
      boxShadow: '0 6px 24px rgba(0,0,0,.25)',
    });
    // On Order management the menu opens with the purchase stats.
    if (orderPage()) {
      const stats = statsBlock().box;
      Object.assign(stats.style, { padding: '6px 14px 10px', borderBottom: '1px solid #e8eaed', marginBottom: '4px' });
      m.appendChild(stats);
    }
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
      title.textContent = (t.active ? '✓ ' : '') + t.label;
      const hint = document.createElement('div');
      Object.assign(hint.style, { color: '#5f6368', fontSize: '12px' });
      hint.textContent = t.hint;
      row.append(title, hint);
      // Active toggles stay highlighted, like the overlay's pills.
      const rest = t.active ? '#e8f0fe' : 'none';
      row.style.background = rest;
      if (t.active) title.style.color = '#1967d2';
      row.onmouseenter = () => (row.style.background = t.active ? '#d2e3fc' : '#f1f3f4');
      row.onmouseleave = () => (row.style.background = rest);
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
