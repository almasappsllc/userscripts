// ==UserScript==
// @name         Console Tools
// @namespace    almas-apps
// @version      1.11.0
// @description  Floating gear menu of Play Console utilities. Bump @version on every change so Tampermonkey picks it up.
// @homepageURL  https://github.com/almasappsllc/userscripts
// @updateURL    https://raw.githubusercontent.com/almasappsllc/userscripts/main/console-tools.user.js
// @downloadURL  https://raw.githubusercontent.com/almasappsllc/userscripts/main/console-tools.user.js
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
  // Read-only: the Console's table is left alone apart from hiding test and
  // refunded rows. License-tester orders show "Test: " in front of the product
  // name; refunded orders show "Refunded" in the status column.
  //
  // Every order that passes through the table (any page, sort or search) is
  // remembered until reload, so the stats cover everything you've paged through,
  // unless "Only count what's on screen" narrows them to the rows in the table now.

  const HOME_CURRENCY = 'CAD';
  // Free, no key, covers GHS/PHP etc. Fetched through GM_xmlhttpRequest so the
  // Console's CSP can't block it. Cached for 12 hours.
  const RATES_URL = `https://open.er-api.com/v6/latest/${HOME_CURRENCY}`;
  const RATES_KEY = 'almas-fx-' + HOME_CURRENCY;
  const TEST_KEY = 'almas-hide-test-orders';
  const REFUND_KEY = 'almas-hide-refunded-orders';
  const BAR_KEY = 'almas-orders-overlay';
  const PAGE_ONLY_KEY = 'almas-orders-page-only';

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  };

  let hideTests = store.get(TEST_KEY) === '1';
  let hideRefunds = store.get(REFUND_KEY) === '1';
  let showBar = store.get(BAR_KEY) === '1';
  let pageOnly = store.get(PAGE_ONLY_KEY) === '1';

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
  // Exact match: a partially refunded order still earned something.
  const isRefundedRow = (row) => /^Refunded$/i.test(cellText(row, 'order_status_column'));

  // order id -> { test, refunded, currency, amount, product }
  const seen = new Map();

  function collect() {
    for (const r of orderRows()) {
      const id = orderId(r);
      if (!id) continue;
      const m = cellText(r, 'total_column').match(/^([A-Z]{3})\s*([\d.,]+)/);
      seen.set(id, {
        test: isTestRow(r),
        refunded: isRefundedRow(r),
        currency: m ? m[1] : '',
        amount: m ? parseFloat(m[2].replace(/,/g, '')) : 0,
        product: cellText(r, 'product_column').replace(/\s*\(.*\)$/, ''),
      });
    }
  }

  function applyOrderFilter() {
    for (const row of orderRows()) {
      const hide = (hideTests && isTestRow(row)) || (hideRefunds && isRefundedRow(row));
      if ((row.style.display === 'none') !== hide) row.style.display = hide ? 'none' : '';
    }
  }

  // Either everything seen since reload, or just the orders in the table now.
  const countedOrders = () => pageOnly
    ? [...new Set(orderRows().map(orderId))].map((id) => seen.get(id)).filter(Boolean)
    : [...seen.values()];

  function summarize() {
    const sums = {}, products = {};
    let total = 0, tests = 0, refunded = 0, paid = 0;
    for (const o of countedOrders()) {
      // Hidden refunds drop out of every count, as if never seen.
      if (o.refunded && hideRefunds) continue;
      total++;
      if (o.test) { tests++; continue; }
      // Refunded orders normally show a 0.00 total; the status catches any that don't.
      if (o.refunded || !(o.amount > 0)) { refunded++; continue; }
      paid++;
      sums[o.currency] = (sums[o.currency] || 0) + o.amount;
      products[o.product] = (products[o.product] || 0) + 1;
    }
    let home = 0;
    const unconverted = [];
    for (const [c, v] of Object.entries(sums)) {
      if (c === HOME_CURRENCY) home += v;
      else if (rates?.[c]) home += v / rates[c];
      else unconverted.push(c);
    }
    return { total, tests, refunded, paid, sums, products, home, unconverted, hideRefunds, pageOnly };
  }

  const el = (tag, style, text) => {
    const e = document.createElement(tag);
    if (style) Object.assign(e.style, style);
    if (text != null) e.textContent = text;
    return e;
  };

  // The full stats block for the gear menu.
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
      `${s.total} orders ${s.pageOnly ? 'on screen' : 'seen'} · ${s.tests} test` +
      (s.hideRefunds ? ' · refunds hidden' : ` · ${s.refunded} refunded`)));
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
      (s.pageOnly ? 'Counts only the orders on screen.' : 'Counts every page you\'ve viewed since reload.') +
      ' Gross, before Google\'s fee' +
      (ratesDate ? ` · rates ${ratesDate}` : '') + '.'));
    return { box, key: JSON.stringify([s, !!rates]) };
  }

  // --- Purchase count bar -------------------------------------------------
  //
  // One line between the filter row and the order table, so it sits right
  // above the rows it counts and next to the filters that change them. Hover it
  // for the per-currency and per-product split; the gear menu has it in full.
  // (Same storage key as the old floating overlay, so its on/off carries over.)

  const BAR_ID = 'almas-orders-bar';
  let barKey = '';

  const barAnchor = () =>
    document.querySelector('orders-list-page orders-filter') ||
    document.querySelector('orders-list-page console-page-header');

  function renderBar() {
    let bar = document.getElementById(BAR_ID);
    const anchor = showBar && orderPage() && barAnchor();
    if (!anchor) { bar?.remove(); barKey = ''; return; }
    if (!bar) {
      // Line up with the filter row's own side padding.
      const pad = getComputedStyle(anchor.querySelector('.wrapper') || anchor).paddingLeft;
      bar = el('div', {
        display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '2px 14px',
        padding: `8px ${parseFloat(pad) > 0 ? pad : '24px'}`,
        fontSize: '13px', lineHeight: '20px',
        borderBottom: '1px solid rgba(128,128,128,.25)',
      });
      bar.id = BAR_ID;
      barKey = '';
    }
    // The Console re-renders around us; put it back after the filters if moved.
    if (bar.previousElementSibling !== anchor) anchor.after(bar);

    const s = summarize();
    const key = JSON.stringify([s, !!rates]);
    if (key === barKey) return;
    barKey = key;

    const parts = [el('span', { fontSize: '15px', fontWeight: '700' },
      `${s.paid} real purchase${s.paid === 1 ? '' : 's'}`)];
    if (s.paid) parts.push(el('span', { fontWeight: '600' }, `≈ ${HOME_CURRENCY} ${s.home.toFixed(2)}`));
    parts.push(el('span', { opacity: '.7' },
      `${s.total} ${s.pageOnly ? 'on screen' : 'seen since reload'} · ${s.tests} test` +
      (s.hideRefunds ? ' · refunds hidden' : ` · ${s.refunded} refunded`)));
    if (s.paid && s.unconverted.length) {
      parts.push(el('span', { color: '#b3261e' },
        (rates ? 'No rate for ' : 'Rates unavailable, not in total: ') + s.unconverted.join(', ')));
    }
    bar.replaceChildren(...parts);
    bar.title = s.paid
      ? [Object.entries(s.sums).map(([c, v]) => `${c} ${v.toFixed(2)}`).join(' · '),
         ...Object.entries(s.products).sort((a, b) => b[1] - a[1]).map(([p, n]) => `${n}× ${p}`),
         'Gross, before Google\'s fee' + (ratesDate ? ` · rates ${ratesDate}` : '')].join('\n')
      : '';
  }

  function setHideTests(on) {
    hideTests = on;
    store.set(TEST_KEY, on ? '1' : '0');
    applyOrderFilter();
    if (!orderPage()) say(`Test orders will be ${on ? 'hidden' : 'shown'} on Order management.`);
  }

  function setHideRefunds(on) {
    hideRefunds = on;
    store.set(REFUND_KEY, on ? '1' : '0');
    applyOrderFilter();
    renderBar();
    if (!orderPage()) say(`Refunded orders will be ${on ? 'hidden' : 'shown'} on Order management.`);
  }

  function setBar(on) {
    showBar = on;
    store.set(BAR_KEY, on ? '1' : '0');
    renderBar();
    if (!orderPage()) say(`Purchase count bar ${on ? 'on' : 'off'}. It shows on Order management.`);
  }

  function setPageOnly(on) {
    pageOnly = on;
    store.set(PAGE_ONLY_KEY, on ? '1' : '0');
    renderBar();
    if (!orderPage()) say(`Purchase stats will count ${on ? 'only the orders on screen' : 'every page viewed since reload'}.`);
  }

  function ordersTick() {
    if (orderPage()) {
      loadRates();
      collect();
      applyOrderFilter();
    }
    renderBar();
    const m = document.getElementById('almas-tools-menu');
    if (m) renderMenuStats(m);
  }

  let ordersPending = 0;
  function scheduleOrders() {
    if (ordersPending) return;
    ordersPending = requestAnimationFrame(() => { ordersPending = 0; ordersTick(); });
  }

  new MutationObserver((muts) => {
    // Ignore our own bar and menu redraws, or every redraw would schedule another.
    if (muts.every((m) => m.target.closest?.('#almas-orders-bar, #almas-tools-menu'))) return;
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
      label: 'Hide refunded orders',
      get active() { return hideRefunds; },
      hint: 'Order management: drop refunds from the table and stats',
      run: () => setHideRefunds(!hideRefunds),
    },
    {
      label: 'Purchase count bar',
      get active() { return showBar; },
      hint: 'One line above the order table: purchases and CAD total',
      run: () => setBar(!showBar),
    },
    {
      label: 'Only count what\'s on screen',
      get active() { return pageOnly; },
      hint: 'Purchase stats cover just this page, not every page since reload',
      run: () => setPageOnly(!pageOnly),
    },
  ];

  // The menu's stats follow the table while it's open, like the count bar: the
  // Console's own filters, paging and our toggles all redraw them. Toggles keep
  // the menu open and redraw it; the price tools close it, since they work the page.

  let menuStatsKey = '';
  function renderMenuStats(m) {
    const slot = m.querySelector('[data-almas-stats]');
    if (!orderPage()) { slot?.remove(); menuStatsKey = ''; return; }
    const { box, key } = statsBlock();
    if (slot && key === menuStatsKey) return;
    menuStatsKey = key;
    box.dataset.almasStats = '1';
    Object.assign(box.style, { padding: '6px 14px 10px', borderBottom: '1px solid #e8eaed', marginBottom: '4px' });
    if (slot) slot.replaceWith(box); else m.prepend(box);
  }

  function renderMenu(m) {
    m.replaceChildren();
    menuStatsKey = '';
    renderMenuStats(m);
    for (const t of TOOLS) {
      const isToggle = 'active' in t;
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
      // Active toggles stay highlighted.
      const rest = t.active ? '#e8f0fe' : 'none';
      row.style.background = rest;
      if (t.active) title.style.color = '#1967d2';
      row.onmouseenter = () => (row.style.background = t.active ? '#d2e3fc' : '#f1f3f4');
      row.onmouseleave = () => (row.style.background = rest);
      row.onclick = () => {
        if (!isToggle) m.remove();
        Promise.resolve(t.run())
          .catch((e) => say('Error: ' + e.message, true))
          .finally(() => { if (isToggle && m.isConnected) renderMenu(m); });
      };
      m.appendChild(row);
    }
  }

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
    renderMenu(m);
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
