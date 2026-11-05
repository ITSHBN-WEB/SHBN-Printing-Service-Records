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
    if (path.startsWith('/api/admin') && adminPass) headers['x-admin-password'] = adminPass;
    const r = await fetch(path, { ...opts, headers });
    const data = await r.json().catch(() => ({}));
    if (r.status === 401) {
      if (data.admin) { adminPass = ''; showAdminGate(true); throw new Error('admin-locked'); }
      showLock(Boolean(code));
      throw new Error('locked');
    }
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
  let adminPass = ''; // kept in memory only; cleared whenever you leave the Admin tab
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
    const r = h.startsWith('#/entries') ? 'entries' : h.startsWith('#/summary') ? 'summary' : h.startsWith('#/admin') ? 'admin' : 'dashboard';
    ['dashboard', 'entries', 'summary', 'admin'].forEach((v) => { $('#view-' + v).hidden = r !== v; });
    document.querySelectorAll('.nav a').forEach((a) => {
      const on = a.dataset.route === r;
      a.classList.toggle('active', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    if (!state.ready) return;
    if (r !== 'admin' && adminPass) lockAdmin();
    if (r === 'admin') { if (!adminPass) showAdminGate(false); window.scrollTo(0, 0); return; }
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

  /* ---------- supplier typeahead (shared by New Entry and Admin) ---------- */
  const rx = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function makeCombo({ input, list, clearBtn, onPick, onClear }) {
    let matches = [];
    let active = 0;
    let tokens = [];
    let selected = null;

    function hl(text) {
      if (!tokens.length) return esc(text);
      const re = new RegExp('(' + tokens.map(rx).join('|') + ')', 'ig');
      return text.split(re).map((p, i) => (i % 2 ? `<mark>${esc(p)}</mark>` : esc(p))).join('');
    }
    function find(q) {
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
    function close() { list.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); }
    function render(q) {
      matches = find(q);
      active = 0;
      if (!q.trim()) return close();
      list.innerHTML = matches.length
        ? matches.map((s, i) => `<li role="option" id="${list.id}-${i}" data-i="${i}" class="${i === 0 ? 'on' : ''}" aria-selected="${i === 0}">
            <span class="b">${hl(s.brand)}</span><span class="s">${hl(s.name)}</span></li>`).join('')
        : '<li class="none">No matching supplier or brand</li>';
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
    }
    function setActive(i) {
      if (!matches.length) return;
      active = (i + matches.length) % matches.length;
      list.querySelectorAll('li').forEach((li, k) => { li.classList.toggle('on', k === active); li.setAttribute('aria-selected', k === active); });
      input.setAttribute('aria-activedescendant', `${list.id}-${active}`);
      list.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
    }
    function pick(s) {
      selected = s;
      input.value = s.brand;
      clearBtn.hidden = false;
      close();
      onPick(s);
    }
    function clear(focus) {
      const had = selected;
      selected = null;
      if (focus) { input.value = ''; input.focus(); close(); }
      clearBtn.hidden = !input.value;
      if (had) onClear();
    }
    // reset without firing callbacks (used after a successful submit)
    function reset() { selected = null; input.value = ''; clearBtn.hidden = true; close(); }

    input.addEventListener('input', () => {
      if (selected && input.value !== selected.brand) clear(false);
      clearBtn.hidden = !input.value;
      render(input.value);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); if (list.hidden) render(input.value); else setActive(active + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
      else if (e.key === 'Enter') { e.preventDefault(); if (!list.hidden && matches.length) pick(matches[active]); }
      else if (e.key === 'Escape') close();
    });
    input.addEventListener('blur', () => setTimeout(close, 120));
    input.addEventListener('focus', () => { if (!selected && input.value) render(input.value); });
    // mousedown (not click) so the pick lands before the input loses focus; works for touch too
    list.addEventListener('mousedown', (e) => {
      const li = e.target.closest('li[data-i]');
      if (!li) return;
      e.preventDefault();
      pick(matches[Number(li.dataset.i)]);
    });
    clearBtn.addEventListener('click', () => clear(true));
    return { reset, clear };
  }

  const brandIn = $('#fBrand');
  const newCombo = makeCombo({
    input: brandIn, list: $('#brandList'), clearBtn: $('#brandClear'),
    onPick(s) {
      state.supplier = s;
      $('#supplierPicked').innerHTML = `Supplier: <b>${esc(s.name)}</b>`;
      $('#supplierPicked').hidden = false;
      refresh();
    },
    onClear() { state.supplier = null; $('#supplierPicked').hidden = true; refresh(); },
  });

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
      newCombo.reset(); qtyIn.value = 1;
      $('#supplierPicked').hidden = true;
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
  const sFrom = $('#sFrom');
  const sTo = $('#sTo');
  const MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
  let sReq = 0;

  const slash = (iso) => iso.split('-').reverse().join('/'); // 2026-10-15 -> 15/10/2026
  const lastDay = (y, m) => new Date(y, m, 0).getDate();     // m is 1-12
  const pad = (n) => String(n).padStart(2, '0');

  // "15/10/2026 - 15/11/2026"
  const periodOf = (from, to) => `${slash(from)} - ${slash(to)}`;

  // A whole calendar month reads as "NOVEMBER 2026"; any other range reads as dates.
  function periodTitle(from, to) {
    const [y, m, d] = from.split('-').map(Number);
    if (d === 1 && to === `${y}-${pad(m)}-${pad(lastDay(y, m))}`) return `${MONTHS[m - 1]} ${y}`;
    return periodOf(from, to);
  }

  function sign(label) {
    return `<div><p class="who">${label}</p><div class="line"></div><p>Name:</p><p>Position:</p><p>Date:</p></div>`;
  }

  function reportHTML(from, to, data) {
    const period = periodOf(from, to);
    const body = data.rows.length
      ? data.rows.map((r, i) => `<tr>
          <td class="c">${i + 1}</td>
          <td class="l">${esc(r.supplier)}</td>
          <td class="l">${esc(r.brand)}</td>
          <td class="c">${period}</td>
          <td class="c">${r.services.map((x) => `<div>${esc(x.service_type)}</div>`).join('')}</td>
          <td class="c">${r.services.map((x) => `<div>${x.qty}</div>`).join('')}</td>
          <td class="r">${money(r.total)}</td></tr>`).join('')
      : '<tr><td colspan="7" class="rnone">No records in this period.</td></tr>';
    return `
      <h1 class="rt">SERVAY EVERGREEN BENONI (SHBN)</h1>
      <h2 class="rs">SUMMARY OF PROMOTER / SUPPLIER VARIOUS CHARGE</h2>
      <p class="rm">MONTH / PERIOD : ${periodTitle(from, to)}</p>
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

  function setRange(from, to) { sFrom.value = from; sTo.value = to; loadSummary(); }
  function showMonth(offset) {
    const t = myToday().split('-').map(Number);
    const d = new Date(t[0], t[1] - 1 + offset, 1);
    const y = d.getFullYear(), m = d.getMonth() + 1;
    setRange(`${y}-${pad(m)}-01`, `${y}-${pad(m)}-${pad(lastDay(y, m))}`);
  }

  async function loadSummary() {
    const from = sFrom.value, to = sTo.value;
    const err = $('#sErr');
    if (!from || !to) { $('#sPrint').disabled = true; err.hidden = true; return; }
    if (from > to) {
      err.textContent = 'The end date must be on or after the start date.';
      err.hidden = false;
      $('#sPrint').disabled = true;
      return;
    }
    err.hidden = true;
    const id = ++sReq;
    let data;
    try { data = await api('/api/summary?' + new URLSearchParams({ from, to })); } catch { return; }
    if (id !== sReq) return;
    $('#sheet').innerHTML = reportHTML(from, to, data);
    $('#sPrint').disabled = !data.rows.length;
    fitOnePage();
  }
  sFrom.addEventListener('input', loadSummary);
  sTo.addEventListener('input', loadSummary);
  $('#sThis').addEventListener('click', () => showMonth(0));
  $('#sLast').addEventListener('click', () => showMonth(-1));
  // window.print() opens the browser's print dialog on this page (no new tab);
  // the dialog closes itself once printing finishes or is cancelled.
  $('#sPrint').addEventListener('click', () => { fitOnePage(); window.print(); });

  /* ---------- admin: edit / delete ---------- */
  const adm = { entries: [], supplier: null };
  const aMonth = $('#aMonth');
  const aBrand = $('#aBrand');
  let aReq = 0;

  function showAdminGate(wrong) {
    $('#adminGate').hidden = false;
    $('#adminBody').hidden = true;
    $('#aErr').hidden = !wrong;
    $('#aPass').value = '';
    if (!$('#view-admin').hidden) $('#aPass').focus();
  }
  function lockAdmin() {
    adminPass = '';
    adm.entries = []; adm.supplier = null;
    adminCombo.reset();
    $('#aResults').hidden = true;
    showAdminGate(false);
  }

  const adminCombo = makeCombo({
    input: aBrand, list: $('#aBrandList'), clearBtn: $('#aBrandClear'),
    onPick(s) { adm.supplier = s; loadAdmin(); },
    onClear() { adm.supplier = null; adm.entries = []; $('#aResults').hidden = true; },
  });

  $('#adminForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    adminPass = $('#aPass').value;
    try {
      await api('/api/admin'); // password check only
    } catch (err) {
      if (err.message !== 'admin-locked' && err.message !== 'locked') toast(err.message);
      return;
    }
    $('#adminGate').hidden = true;
    $('#adminBody').hidden = false;
    if (!aMonth.value) aMonth.value = myToday().slice(0, 7);
    aBrand.focus();
  });

  aMonth.addEventListener('input', () => {
    if (adm.supplier) loadAdmin();
  });

  const svcOptions = (sel) =>
    (sel == null ? '<option value="">Select service…</option>' : '') +
    state.services.map((v) => `<option value="${v.id}"${v.id === sel ? ' selected' : ''}>${esc(v.name)}</option>`).join('');

  function rowHTML(e) {
    return `<tr data-id="${e.id}">
      <td data-label="Date"><input type="date" class="r-date" value="${e.entry_date}" aria-label="Date"></td>
      <td data-label="Service"><select class="r-svc" aria-label="Service type">${svcOptions(e.service_id)}</select></td>
      <td class="num" data-label="Qty"><input type="number" class="r-qty" min="1" step="1" inputmode="numeric" value="${e.qty}" aria-label="Quantity"></td>
      <td class="num r-charge" data-label="Charge (RM)">${money(e.charge)}</td>
      <td class="num r-amt" data-label="Amount (RM)"><b>${money(e.amount)}</b></td>
      <td class="act"><button type="button" class="btn sm primary" data-act="save" disabled>Save</button><button type="button" class="btn sm danger" data-act="del">Delete</button></td>
    </tr>`;
  }

  function renderAdmin() {
    const tb = $('#aBody');
    tb.innerHTML = adm.entries.length
      ? adm.entries.map(rowHTML).join('')
      : '<tr><td colspan="6" class="empty" style="display:table-cell;text-align:center">No entries for this brand in the selected month.</td></tr>';
    adminFooter();
  }

  function adminFooter() {
    const total = adm.entries.reduce((a, e) => a + Math.round(e.amount * 100), 0) / 100;
    $('#aCount').textContent = plural(adm.entries.length, 'entry').replace('entrys', 'entries');
    $('#aTotal').textContent = 'RM ' + money(total);
  }

  async function loadAdmin() {
    if (!adm.supplier || !aMonth.value) { $('#aResults').hidden = true; return; }
    const id = ++aReq;
    let data;
    try {
      data = await api('/api/admin?' + new URLSearchParams({ month: aMonth.value, supplier_id: adm.supplier.id }));
    } catch (err) {
      if (err.message !== 'admin-locked' && err.message !== 'locked') toast(err.message);
      return;
    }
    if (id !== aReq) return;
    adm.entries = data.entries;
    const [y, m] = aMonth.value.split('-').map(Number);
    $('#aHead').textContent = adm.supplier.brand;
    $('#aSub').textContent = `${adm.supplier.name} · ${MONTHS[m - 1]} ${y}`;
    $('#aResults').hidden = false;
    renderAdmin();
  }

  // Live preview of a row: amount, and whether anything changed.
  function syncRow(tr) {
    const e = adm.entries.find((x) => String(x.id) === tr.dataset.id);
    if (!e) return;
    const date = tr.querySelector('.r-date').value;
    const sid = Number(tr.querySelector('.r-svc').value) || null;
    const qty = parseInt(tr.querySelector('.r-qty').value, 10);
    const svc = state.services.find((v) => v.id === sid);
    // unchanged service keeps its original charge; a new service uses today's charge
    const charge = sid === e.service_id ? e.charge : (svc ? svc.charge : 0);
    const valid = Boolean(date && svc && Number.isInteger(qty) && qty > 0);
    tr.querySelector('.r-charge').textContent = money(charge);
    tr.querySelector('.r-amt b').textContent = valid ? money(Math.round(charge * 100) * qty / 100) : '—';
    const dirty = date !== e.entry_date || sid !== e.service_id || qty !== e.qty;
    tr.classList.toggle('dirty', dirty);
    tr.querySelector('[data-act=save]').disabled = !(valid && dirty);
  }
  $('#aBody').addEventListener('input', (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) syncRow(tr); });
  $('#aBody').addEventListener('change', (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) syncRow(tr); });

  $('#aBody').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const tr = btn.closest('tr');
    const id = tr.dataset.id; // ids may arrive as text (bigint), so always compare as strings

    if (btn.dataset.act === 'del') {
      if (!btn.classList.contains('armed')) {           // first click arms, second confirms
        btn.classList.add('armed'); btn.textContent = 'Confirm delete';
        setTimeout(() => { if (btn.isConnected) { btn.classList.remove('armed'); btn.textContent = 'Delete'; } }, 3500);
        return;
      }
      btn.disabled = true;
      try {
        await api('/api/admin?id=' + id, { method: 'DELETE' });
        adm.entries = adm.entries.filter((x) => String(x.id) !== id);
        renderAdmin();
        toast('Entry deleted');
      } catch (err) {
        btn.disabled = false;
        if (err.message !== 'admin-locked' && err.message !== 'locked') toast(err.message);
      }
      return;
    }

    // save
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const { entry } = await api('/api/admin', {
        method: 'PUT',
        body: JSON.stringify({
          id: Number(id),
          entry_date: tr.querySelector('.r-date').value,
          service_id: Number(tr.querySelector('.r-svc').value),
          qty: Number(tr.querySelector('.r-qty').value),
        }),
      });
      const moved = entry.entry_date.slice(0, 7) !== aMonth.value;
      if (moved) {
        adm.entries = adm.entries.filter((x) => String(x.id) !== id);
        renderAdmin();
        toast(`Saved. Moved to ${dmy(entry.entry_date)}, outside this month`);
      } else {
        adm.entries = adm.entries.map((x) => (String(x.id) === id ? entry : x));
        const t = document.createElement('tbody');
        t.innerHTML = rowHTML(entry);
        tr.replaceWith(t.firstElementChild);
        adminFooter();
        toast('Entry updated');
      }
    } catch (err) {
      btn.textContent = 'Save'; syncRow(tr);
      if (err.message !== 'admin-locked' && err.message !== 'locked') toast(err.message);
    }
  });

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
    sFrom.value = myToday().slice(0, 7) + '-01';
    sTo.value = myToday();
    renderServices();
    refresh();
    route();
  }
  init();
})();
