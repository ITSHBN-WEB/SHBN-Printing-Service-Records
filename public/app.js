(() => {
  'use strict';

  /* ---------- helpers ---------- */
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => Number(n).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const TZ = 'Asia/Kuala_Lumpur';
  const myToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date()); // YYYY-MM-DD
  const myHour = () => Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
  const dmy = (iso) => iso.split('-').reverse().join('.'); // 2026-11-02 -> 02.11.2026
  const timeOf = (ts) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h12' }).format(new Date(ts));

  const store = {
    get() { try { return sessionStorage.getItem('shbn-code') || ''; } catch { return ''; } },
    set(v) { try { sessionStorage.setItem('shbn-code', v); } catch { /* ignore */ } },
  };

  async function api(path, opts = {}) {
    const headers = { 'content-type': 'application/json' };
    const code = store.get();
    if (code) headers['x-access-code'] = code;
    const r = await fetch(path, { ...opts, headers });
    if (r.status === 401) { showLock(Boolean(code)); throw new Error('locked'); }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
  }

  /* ---------- state ---------- */
  const state = { suppliers: [], services: [], supplier: null, service: null, qty: 1, ready: false };

  /* ---------- lock ---------- */
  function showLock(wrong) {
    $('#shell').hidden = true;
    $('#lock').hidden = false;
    $('#lockErr').hidden = !wrong;
    $('#lockInput').value = '';
    $('#lockInput').focus();
  }
  $('#lockForm').addEventListener('submit', (e) => {
    e.preventDefault();
    store.set($('#lockInput').value);
    init();
  });

  /* ---------- routing ---------- */
  function route() {
    const h = location.hash;
    const r = h.startsWith('#/entries') ? 'entries' : h.startsWith('#/summary') ? 'summary' : 'dashboard';
    ['dashboard', 'entries', 'summary'].forEach((v) => { $('#view-' + v).hidden = r !== v; });
    document.querySelectorAll('.nav a').forEach((a) => {
      const on = a.dataset.route === r;
      a.classList.toggle('active', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    if (!state.ready) return;
    if (r === 'dashboard') loadDashboard(); else if (r === 'entries') loadEntries(); else loadSummary();
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', route);

  /* ---------- dashboard ---------- */
  function renderGreeting() {
    const h = myHour();
    const part = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
    $('#greeting').textContent = `${part}, SHBN team`;
    $('#todayLabel').textContent = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
  }

  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

  async function loadDashboard() {
    renderGreeting();
    const [stats, recent] = await Promise.all([api('/api/stats'), api('/api/entries?limit=8')]).catch(() => [null, null]);
    if (stats) {
      $('#stToday').textContent = `RM ${money(stats.today.total)}`;
      $('#stTodayN').textContent = plural(stats.today.count, 'entry').replace('entrys', 'entries');
      $('#stMonth').textContent = `RM ${money(stats.month.total)}`;
      $('#stMonthN').textContent = plural(stats.month.count, 'entry').replace('entrys', 'entries');
    }
    if (recent) renderRecent(recent.entries);
  }

  function renderRecent(list, highlightId) {
    const ul = $('#recentList');
    if (!list.length) { ul.innerHTML = '<li class="empty">No entries yet. Submit your first one.</li>'; return; }
    ul.innerHTML = list.map((e) => `
      <li class="${e.id === highlightId ? 'pop' : ''}">
        <div>
          <div class="t">${esc(e.brand)}</div>
          <div class="m">${esc(e.service_type)} &times; ${e.qty}</div>
          <div class="m">${dmy(e.entry_date)} &middot; ${timeOf(e.created_at)}</div>
        </div>
        <div class="a">RM ${money(e.amount)}</div>
      </li>`).join('');
  }

  /* ---------- supplier typeahead ---------- */
  const brandIn = $('#fBrand');
  const list = $('#brandList');
  let matches = [];
  let active = 0;
  let tokens = [];

  const rx = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  function hl(text) {
    if (!tokens.length) return esc(text);
    const re = new RegExp('(' + tokens.map(rx).join('|') + ')', 'ig');
    return text.split(re).map((p, i) => (i % 2 ? `<mark>${esc(p)}</mark>` : esc(p))).join('');
  }

  function findSuppliers(q) {
    tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!tokens.length) return [];
    const out = [];
    for (const s of state.suppliers) {
      const b = s.brand.toLowerCase();
      const n = s.name.toLowerCase();
      if (!tokens.every((t) => (b + ' ' + n).includes(t))) continue;
      const rank = b.startsWith(tokens[0]) ? 0 : b.includes(tokens[0]) ? 1 : n.startsWith(tokens[0]) ? 2 : 3;
      out.push({ s, rank });
    }
    return out.sort((a, b) => a.rank - b.rank || a.s.brand.localeCompare(b.s.brand)).slice(0, 8).map((x) => x.s);
  }

  function renderOpts(q) {
    matches = findSuppliers(q);
    active = 0;
    if (!q.trim()) return closeOpts();
    list.innerHTML = matches.length
      ? matches.map((s, i) => `<li role="option" id="opt-${i}" data-i="${i}" class="${i === 0 ? 'on' : ''}" aria-selected="${i === 0}">
          <span class="b">${hl(s.brand)}</span><span class="s">${hl(s.name)}</span></li>`).join('')
      : '<li class="none">No matching supplier or brand</li>';
    list.hidden = false;
    brandIn.setAttribute('aria-expanded', 'true');
  }
  function closeOpts() { list.hidden = true; brandIn.setAttribute('aria-expanded', 'false'); brandIn.removeAttribute('aria-activedescendant'); }
  function setActive(i) {
    if (!matches.length) return;
    active = (i + matches.length) % matches.length;
    list.querySelectorAll('li').forEach((li, k) => { li.classList.toggle('on', k === active); li.setAttribute('aria-selected', k === active); });
    brandIn.setAttribute('aria-activedescendant', `opt-${active}`);
    list.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
  }
  function pick(s) {
    state.supplier = s;
    brandIn.value = s.brand;
    $('#supplierPicked').innerHTML = `Supplier: <b>${esc(s.name)}</b>`;
    $('#supplierPicked').hidden = false;
    $('#brandClear').hidden = false;
    closeOpts();
    refresh();
  }
  function clearSupplier(focus) {
    state.supplier = null;
    $('#supplierPicked').hidden = true;
    $('#brandClear').hidden = !brandIn.value;
    if (focus) { brandIn.value = ''; brandIn.focus(); closeOpts(); }
    refresh();
  }

  brandIn.addEventListener('input', () => {
    if (state.supplier && brandIn.value !== state.supplier.brand) clearSupplier(false);
    $('#brandClear').hidden = !brandIn.value;
    renderOpts(brandIn.value);
  });
  brandIn.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (list.hidden) renderOpts(brandIn.value); else setActive(active + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
    else if (e.key === 'Enter') { if (!list.hidden && matches.length) { e.preventDefault(); pick(matches[active]); } else e.preventDefault(); }
    else if (e.key === 'Escape') closeOpts();
  });
  brandIn.addEventListener('blur', () => setTimeout(closeOpts, 120));
  brandIn.addEventListener('focus', () => { if (!state.supplier && brandIn.value) renderOpts(brandIn.value); });
  // mousedown (not click) so the pick lands before the input loses focus; works for touch too
  list.addEventListener('mousedown', (e) => {
    const li = e.target.closest('li[data-i]');
    if (!li) return;
    e.preventDefault();
    pick(matches[Number(li.dataset.i)]);
  });
  $('#brandClear').addEventListener('click', () => clearSupplier(true));

  /* ---------- services, qty, total ---------- */
  function renderServices() {
    $('#svcGrid').innerHTML = state.services.map((v) => `
      <button type="button" class="svc" role="radio" aria-checked="${state.service?.id === v.id}" data-id="${v.id}">
        <span class="n">${esc(v.name)}</span><span class="c">RM ${money(v.charge)}</span>
      </button>`).join('');
  }
  $('#svcGrid').addEventListener('click', (e) => {
    const b = e.target.closest('.svc');
    if (!b) return;
    state.service = state.services.find((v) => v.id === Number(b.dataset.id));
    renderServices();
    refresh();
  });

  const qtyIn = $('#fQty');
  function readQty() { const n = parseInt(qtyIn.value, 10); return Number.isInteger(n) && n > 0 ? n : 0; }
  qtyIn.addEventListener('input', refresh);
  $('#qtyMinus').addEventListener('click', () => { qtyIn.value = Math.max(1, (readQty() || 1) - 1); refresh(); });
  $('#qtyPlus').addEventListener('click', () => { qtyIn.value = (readQty() || 0) + 1; refresh(); });

  // Money math in cents to avoid floating point surprises.
  const totalOf = (charge, qty) => Math.round(charge * 100) * qty / 100;

  function refresh() {
    const qty = readQty();
    const svc = state.service;
    if (svc && qty) {
      $('#totalAmt').textContent = `RM ${money(totalOf(svc.charge, qty))}`;
      $('#totalCalc').textContent = `RM ${money(svc.charge)} × ${qty}`;
    } else {
      $('#totalAmt').textContent = 'RM 0.00';
      $('#totalCalc').textContent = svc ? 'Enter a quantity' : 'Choose a service';
    }
    $('#submitBtn').disabled = !(state.supplier && svc && qty && $('#fDate').value);
    $('#formErr').hidden = true;
  }
  $('#fDate').addEventListener('input', refresh);

  /* ---------- submit ---------- */
  $('#entryForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#submitBtn');
    if (btn.disabled) return;
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      const { entry } = await api('/api/entries', {
        method: 'POST',
        body: JSON.stringify({
          entry_date: $('#fDate').value,
          supplier_id: state.supplier.id,
          service_id: state.service.id,
          qty: readQty(),
        }),
      });
      toast(`Saved: ${entry.brand} · ${entry.service_type} × ${entry.qty} = RM ${money(entry.amount)}`);
      // reset everything except the date (staff often enter several for the same day)
      state.supplier = null; state.service = null;
      brandIn.value = ''; qtyIn.value = 1;
      $('#supplierPicked').hidden = true; $('#brandClear').hidden = true;
      renderServices();
      refresh();
      const [stats, recent] = await Promise.all([api('/api/stats'), api('/api/entries?limit=8')]);
      renderRecent(recent.entries, entry.id);
      $('#stToday').textContent = `RM ${money(stats.today.total)}`;
      $('#stTodayN').textContent = plural(stats.today.count, 'entry').replace('entrys', 'entries');
      $('#stMonth').textContent = `RM ${money(stats.month.total)}`;
      $('#stMonthN').textContent = plural(stats.month.count, 'entry').replace('entrys', 'entries');
      brandIn.focus();
    } catch (err) {
      if (err.message !== 'locked') { const f = $('#formErr'); f.textContent = err.message; f.hidden = false; }
    } finally {
      btn.textContent = 'Submit entry';
      refresh();
    }
  });

  /* ---------- submitted entries ---------- */
  const eMonth = $('#eMonth');
  const eSearch = $('#eSearch');
  let searchTimer;
  let reqId = 0;

  async function loadEntries() {
    const id = ++reqId;
    const p = new URLSearchParams({ limit: '500' });
    if (eMonth.value) p.set('month', eMonth.value);
    if (eSearch.value.trim()) p.set('q', eSearch.value.trim());
    let data;
    try { data = await api('/api/entries?' + p); } catch { return; }
    if (id !== reqId) return; // a newer request superseded this one
    $('#eBody').innerHTML = data.entries.length
      ? data.entries.map((e) => `<tr>
          <td class="date" data-label="Date">${dmy(e.entry_date)}</td>
          <td class="sup" data-label="Supplier">${esc(e.supplier)}</td>
          <td class="brand" data-label="Brand">${esc(e.brand)}</td>
          <td data-label="Service">${esc(e.service_type)}</td>
          <td class="num" data-label="Qty">${e.qty}</td>
          <td class="num" data-label="Charge (RM)">${money(e.charge)}</td>
          <td class="num" data-label="Amount (RM)"><b>${money(e.amount)}</b></td></tr>`).join('')
      : '<tr><td colspan="7" class="empty" style="display:table-cell;text-align:center">No entries found.</td></tr>';
    const shown = data.entries.length;
    $('#eCount').textContent = shown < data.count ? `Showing ${shown} of ${data.count} entries` : plural(data.count, 'entry').replace('entrys', 'entries');
    $('#eTotal').textContent = 'RM ' + money(data.total);
  }
  eMonth.addEventListener('input', loadEntries);
  eSearch.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(loadEntries, 250); });
  $('#eAll').addEventListener('click', () => { eMonth.value = ''; loadEntries(); });

  /* ---------- monthly summary report ---------- */
  const sMonth = $('#sMonth');
  const MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
  let sReq = 0;

  // "2026-11" -> "01/11/2026 - 30/11/2026"
  function periodOf(ym) {
    const [y, m] = ym.split('-').map(Number);
    const last = new Date(y, m, 0).getDate();
    const mm = String(m).padStart(2, '0');
    return `01/${mm}/${y} - ${last}/${mm}/${y}`;
  }

  function sign(label) {
    return `<div><p class="who">${label}</p><div class="line"></div><p>Name:</p><p>Position:</p><p>Date:</p></div>`;
  }

  function reportHTML(ym, data) {
    const [y, m] = ym.split('-').map(Number);
    const period = periodOf(ym);
    const body = data.rows.length
      ? data.rows.map((r, i) => `<tr>
          <td class="c">${i + 1}</td>
          <td class="l">${esc(r.supplier)}</td>
          <td class="l">${esc(r.brand)}</td>
          <td class="c">${period}</td>
          <td class="c">${r.services.map((x) => `<div>${esc(x.service_type)}</div>`).join('')}</td>
          <td class="c">${r.services.map((x) => `<div>${x.qty}</div>`).join('')}</td>
          <td class="r">${money(r.total)}</td></tr>`).join('')
      : '<tr><td colspan="7" class="rnone">No records for this month.</td></tr>';
    return `
      <h1 class="rt">SERVAY EVERGREEN BENONI (SHBN)</h1>
      <h2 class="rs">SUMMARY OF PROMOTER / SUPPLIER VARIOUS CHARGE</h2>
      <p class="rm">MONTH / PERIOD : ${MONTHS[m - 1]} ${y}</p>
      <table class="rt-tbl">
        <colgroup><col style="width:5%"><col style="width:23%"><col style="width:15%"><col style="width:17%"><col style="width:17%"><col style="width:11%"><col style="width:12%"></colgroup>
        <thead><tr><th>NO.</th><th>NAME OF COMPANY</th><th>BRAND</th><th>RECORD / CHARGE PERIOD</th><th>SERVICE TYPE</th><th>QUANTITY</th><th>TOTAL CHARGE (RM)</th></tr></thead>
        <tbody>${body}
          <tr class="gt"><td class="nb" colspan="4"></td><td class="r" colspan="2">GRAND TOTAL (RM)</td><td class="r">${money(data.grand_total)}</td></tr>
        </tbody>
      </table>
      <div class="sign">${sign('Prepared by,')}${sign('Verified by,')}</div>`;
  }

  // Shrink the report's text until it fits one A4 page (printable height 277mm).
  function fitOnePage() {
    const paper = $('#paper');
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;visibility:hidden;height:268mm;width:1px';
    document.body.appendChild(probe);
    const maxH = probe.offsetHeight;
    probe.remove();
    let scale = 1;
    paper.style.setProperty('--s', scale);
    while ($('#sheet').offsetHeight > maxH && scale > 0.3) {
      scale = Math.round((scale - 0.03) * 100) / 100;
      paper.style.setProperty('--s', scale);
    }
  }

  async function loadSummary() {
    const ym = sMonth.value;
    if (!ym) return;
    const id = ++sReq;
    let data;
    try { data = await api('/api/summary?month=' + ym); } catch { return; }
    if (id !== sReq) return;
    $('#sheet').innerHTML = reportHTML(ym, data);
    $('#sPrint').disabled = !data.rows.length;
    fitOnePage();
  }
  sMonth.addEventListener('input', loadSummary);
  // window.print() opens the browser's print dialog on this page (no new tab);
  // the dialog closes itself once printing finishes or is cancelled.
  $('#sPrint').addEventListener('click', () => { fitOnePage(); window.print(); });

  /* ---------- init ---------- */
  async function init() {
    try {
      const data = await api('/api/lookups');
      state.suppliers = data.suppliers;
      state.services = data.services;
    } catch (err) {
      if (err.message !== 'locked') toast('Could not load data: ' + err.message);
      return;
    }
    $('#lock').hidden = true;
    $('#shell').hidden = false;
    state.ready = true;
    $('#fDate').value = myToday();
    eMonth.value = myToday().slice(0, 7);
    sMonth.value = myToday().slice(0, 7);
    renderServices();
    refresh();
    route();
  }
  init();
})();
