// DOM layer: turns touches into game.js calls, draws the active map, plays effects.
import * as G from './game.js';
import * as S from './storage.js';
import { sfx, buzz, floatText, burst, pulse, fxSettings } from './fx.js';
import { TownMap } from './townmap.js';
import { LandMap } from './landmap.js';

export const BUILD = '0.8.0';

const $ = sel => document.querySelector(sel);
let c, s, maps, selected = null, editing = null;   // editing: 'hire:<id>' while planning a merchant's route
let planKey = '', upKey = '', tradeKey = '', infoKey = '', hireKey = '';

const view = () => s.view;            // 'town' | 'land'
const map = () => maps[s.view];
const planLevel = () => editing || view();

export async function start() {
  c = await (await fetch('data/world.json', { cache: 'no-cache' })).json();
  Object.assign(fxSettings, S.loadSettings());
  s = G.createState(c);
  const saved = S.loadSave();
  if (saved) { try { s = G.deserialize(c, saved); } catch (e) { console.warn('Bad save, starting fresh', e); } }

  const cv = $('#map');
  maps = { town: new TownMap(cv, c, () => s), land: new LandMap(cv, c, () => s) };
  new ResizeObserver(() => { maps.town.resize(); maps.land.resize(); }).observe(cv);
  fixView();
  bindMap();
  bindPanel();
  bindMenu();
  catchUp();

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.25, (now - last) / 1000); last = now;
    handle(G.tick(c, s, dt));
    fixView();
    render();
    map().draw(dt, now);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  setInterval(save, 5000);
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); else catchUp(); });
  window.addEventListener('pagehide', save);
}

function save() { s.lastSeen = Date.now(); S.writeSave(G.serialize(s)); }

function catchUp() {
  const secs = (Date.now() - s.lastSeen) / 1000;
  s.lastSeen = Date.now();
  if (secs < 3) return;
  const gained = G.applyOffline(c, s, secs);
  if (gained > 0 && secs > 20) {
    $('#away-time').textContent = fmtTime(secs);
    $('#away-n').textContent = G.formatNumber(gained);
    $('#away').hidden = false;
  }
  save();
}

function fmtTime(sec) {
  if (sec < 60) return Math.round(sec) + 's';
  if (sec < 3600) return Math.floor(sec / 60) + 'm ' + (Math.round(sec % 60) ? Math.round(sec % 60) + 's' : '');
  return Math.floor(sec / 3600) + 'h ' + Math.floor((sec % 3600) / 60) + 'm';
}

// No town view while riding between towns; no land view before the horse.
function fixView() {
  if (s.view === 'town' && !s.town) setView('land', true);
  if (s.view === 'land' && !G.landUnlocked(c, s)) setView('town', true);
}

function setView(v, quiet) {
  if (s.view === v) return;
  if (v === 'town' && !s.town) return;
  if (v === 'land' && !G.landUnlocked(c, s)) return;
  s.view = v; selected = null; maps.land.selected = null;
  if (v !== 'land') setEditing(null);
  planKey = tradeKey = infoKey = '';
  const cv = $('#map');
  pulse(cv, v === 'land' ? 'zoom-out' : 'zoom-in');
  if (!quiet) { sfx.unlock(); buzz(10); }
  renderViewBtn();
}

function renderViewBtn() {
  const b = $('#view-btn');
  const k = [s.view, s.town, G.landUnlocked(c, s)].join();
  if (b.dataset.k === k) return; b.dataset.k = k;
  const can = G.landUnlocked(c, s);
  b.hidden = !can || (s.view === 'land' && !s.town);
  b.textContent = s.view === 'town' ? '🗺️ Land' : `🏘️ ${c.towns[s.town]?.name ?? ''}`;
}

// ---------- map input ----------

function bindMap() {
  const cv = $('#map');
  const pts = new Map();
  let tracing = false, traced = 0, downAt = null, pinchStart = 0, pinched = false;

  cv.addEventListener('pointerdown', e => {
    e.preventDefault();
    try { cv.setPointerCapture(e.pointerId); } catch {}
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 2) { pinchStart = spread(); pinched = false; tracing = false; return; }
    if (pts.size > 2) return;
    const L = G.activeLevel(s);
    if (L === view() && !editing) {
      const tr = G.route(s, L).trip;
      if (tr.atStop) { pulse($('#trade'), 'shake'); sfx.deny(); return; }
      if (G.hurry(c, s)) { sfx.tap(); buzz(6); map().puff(); floatText(e.clientX, e.clientY - 10, '»', 'tap'); }
      return;
    }
    downAt = map().hitNode(e.clientX, e.clientY);
    tracing = G.canPlan(c, s, planLevel()); traced = 0;
  });
  cv.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 2 && pinchStart && !pinched) {
      const k = spread() / pinchStart;
      if (k < 0.72 && view() === 'town') { pinched = true; setView('land'); }
      else if (k > 1.38 && view() === 'land') { pinched = true; setView('town'); }
      return;
    }
    if (!tracing || pts.size !== 1) return;
    const id = map().hitNode(e.clientX, e.clientY);
    if (!id) return;
    if (traced === 0 && id !== downAt) { addStop(downAt); traced++; }
    if (traced > 0 || id !== downAt) { if (addStop(id)) traced++; }
  });
  const end = e => {
    const wasSingle = pts.size === 1 && !pinched;
    pts.delete(e.pointerId);
    if (pts.size < 2) pinchStart = 0;
    if (pts.size === 0) pinched = false;
    if (!wasSingle || e.type === 'pointercancel') { tracing = false; return; }
    if (tracing && traced === 0 && downAt) tapNode(downAt);
    else if (!tracing && downAt && view() === 'land') tapNode(downAt);
    tracing = false; downAt = null;
  };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  function spread() { const [a, b] = [...pts.values()]; return Math.hypot(a[0] - b[0], a[1] - b[1]); }
}

// A plain tap: in town it adds a stop; on the land map it opens that town's card
// (tapping the town you're in goes into it).
function tapNode(id) {
  if (view() === 'town') { addStop(id); return; }
  if (id === s.town && !G.activeLevel(s) && !editing) { setView('town'); return; }
  selected = id; maps.land.selected = id; infoKey = '';
  $('#panel').scrollTo({ top: 0, behavior: 'smooth' });
  sfx.tap(); buzz(4); map().poke(id);
}

function addStop(id) {
  if (!id || !G.planAdd(c, s, planLevel(), id)) return false;
  sfx.tap(); buzz(5); map().poke(id);
  const p = map().nodePagePos(id);
  if (p) floatText(p[0], p[1] - 30, String(G.route(s, planLevel()).plan.length), 'tap');
  return true;
}

// ---------- events from the simulation ----------

function posFor(level, id) {
  if (level === view() || (G.isHire(level) && view() === 'land')) { const p = map().nodePagePos(id); if (p) return p; }
  const r = $('#map').getBoundingClientRect();
  return [r.left + r.width / 2, r.top + r.height / 2];
}

function handle(events) {
  for (const ev of events) {
    if (G.isHire(ev.level) && ev.type !== 'sell') continue; // hired merchants: only their sales make noise
    if (ev.type === 'arrive') {
      if (ev.level === view()) map().poke(ev.b);
      buzz(8);
      if (!ev.auto) sfx.unlock();
      $('#panel').scrollTo({ top: 0, behavior: 'smooth' });
    } else if (ev.type === 'sell') {
      const [x, y] = posFor(ev.level, ev.b);
      floatText(x, y - 20, `+${G.formatNumber(ev.coins)} 🪙`, 'coin');
      burst(x, y, Math.min(10, 3 + ev.n), '🪙');
      if (!G.isHire(ev.level)) sfx.coin(true); else sfx.coin(false);
      pulse($('#coins'), 'bump');
    } else if (ev.type === 'buy') {
      const [x, y] = posFor(ev.level, ev.b);
      floatText(x + 20, y - 4, `+${ev.n} ${c.goods[ev.good].icon}`, 'hire');
      sfx.hire(); pulse($('#bag'), 'bump');
    } else if (ev.type === 'done') {
      if (ev.profit > 0) { const [x, y] = map().merchantPagePos(); floatText(x, y - 50, 'Loop +' + G.formatNumber(ev.profit), 'milestone'); }
      sfx.unlock(); buzz([10, 30, 10]);
      save();
    } else if (ev.type === 'achievement') showAchievement(ev.id);
  }
}

function showAchievement(id) {
  const a = c.achievements[id], el = $('#toast');
  el.innerHTML = `<b>🏆 ${a.name}</b><span>${a.desc}</span>`;
  el.hidden = false; pulse(el, 'toast-in');
  sfx.milestone(); buzz([20, 50, 20, 50, 40]);
  clearTimeout(showAchievement.t);
  showAchievement.t = setTimeout(() => { el.hidden = true; }, 3500);
}

// ---------- panel ----------

function bindPanel() {
  onPress($('#view-btn'), () => setView(s.view === 'town' ? 'land' : 'town'));
  onPress($('#go'), () => {
    if (editing) {
      const r = G.route(s, editing);
      if (r.trip) { G.hireStop(c, s, editing); sfx.tap(); }
      else if (G.startTrip(c, s, editing)) { sfx.unlock(); buzz(12); setEditing(null); }
      else { sfx.deny(); pulse($('#go'), 'shake'); }
      return;
    }
    const L = G.activeLevel(s);
    if (L) { if (L === view() && G.requestStop(c, s)) { sfx.tap(); buzz(8); pulse($('#go'), 'squish'); } return; }
    if (G.startTrip(c, s, view())) { sfx.unlock(); buzz(12); pulse($('#go'), 'squish'); }
    else { sfx.deny(); pulse($('#go'), 'shake'); }
  });
  onPress($('#clear'), () => { G.planClear(c, s, planLevel()); sfx.tap(); });
  $('#plan').addEventListener('pointerdown', e => {
    const chip = e.target.closest('[data-good]'), rm = e.target.closest('[data-rm]');
    if (chip) { e.preventDefault(); G.toggleOrder(c, s, planLevel(), +chip.dataset.i, chip.dataset.good); sfx.tap(); buzz(4); }
    else if (rm) { e.preventDefault(); G.planRemove(c, s, planLevel(), +rm.dataset.rm); sfx.tap(); }
  });
  $('#trade').addEventListener('pointerdown', e => {
    const btn = e.target.closest('[data-act]'); if (!btn) return;
    e.preventDefault();
    const g = btn.dataset.good, act = btn.dataset.act;
    if (act === 'continue') { if (G.continueTrip(c, s)) { sfx.tap(); buzz(8); } return; }
    const n = act.endsWith('all') ? 1e9 : 1;
    const ev = act.startsWith('buy') ? G.tradeBuy(c, s, g, n) : G.tradeSell(c, s, g, n);
    if (!ev) { sfx.deny(); pulse(btn, 'shake'); return; }
    const r = btn.getBoundingClientRect();
    if (ev.type === 'sell') { floatText(r.left + r.width / 2, r.top, `+${G.formatNumber(ev.coins)} 🪙`, 'coin'); burst(r.left + r.width / 2, r.top, Math.min(10, 2 + ev.n)); sfx.coin(true); pulse($('#coins'), 'bump'); }
    else { floatText(r.left + r.width / 2, r.top, `+${ev.n} ${c.goods[g].icon}`, 'hire'); sfx.hire(); pulse($('#bag'), 'bump'); }
    buzz(8); pulse(btn, 'squish');
  });
  $('#info').addEventListener('pointerdown', e => {
    const btn = e.target.closest('[data-info]'); if (!btn) return;
    e.preventDefault();
    if (btn.dataset.info === 'add') { if (!addStop(selected)) { sfx.deny(); pulse(btn, 'shake'); } }
    else if (btn.dataset.info === 'enter') setView('town');
    else { selected = null; maps.land.selected = null; infoKey = ''; sfx.tap(); }
  });
  $('#hires').addEventListener('pointerdown', e => {
    const btn = e.target.closest('[data-h]'); if (!btn) return;
    e.preventDefault();
    const act = btn.dataset.h, lv = btn.dataset.lv;
    if (act === 'hire') {
      const evs = G.hire(c, s);
      if (!evs) { sfx.deny(); pulse(btn, 'shake'); return; }
      const r = btn.getBoundingClientRect(); burst(r.left + r.width / 2, r.top, 14, '🧑'); sfx.unlock(); buzz([10, 40, 20]);
      handle(evs); setEditing('hire:' + evs[0].id); save();
    } else if (act === 'edit') { setEditing(editing === lv ? null : lv); sfx.tap(); }
    else if (act === 'stop') { G.hireStop(c, s, lv); sfx.tap(); }
    else if (act === 'start') { if (G.startTrip(c, s, lv)) { sfx.unlock(); buzz(12); if (editing === lv) setEditing(null); } else { sfx.deny(); pulse(btn, 'shake'); } }
  });
  $('#upgrades').addEventListener('pointerdown', e => {
    const btn = e.target.closest('[data-buy]'); if (!btn) return;
    e.preventDefault();
    const evs = G.buyUpgrade(c, s, btn.dataset.buy);
    if (!evs) { sfx.deny(); pulse(btn, 'shake'); return; }
    const r = btn.getBoundingClientRect();
    burst(r.left + r.width / 2, r.top, 14, '✨'); sfx.unlock(); buzz([10, 40, 20]);
    handle(evs);
    if (btn.dataset.buy === 'horse') setTimeout(() => { $('#beyond').hidden = false; }, 600);
    renderViewBtn();
    save();
  });
  onPress($('#beyond-ok'), () => { $('#beyond').hidden = true; setView('land'); $('#panel').scrollTo({ top: 0 }); });
  onPress($('#away-ok'), (x, y) => { $('#away').hidden = true; burst(x, y, 16); sfx.coin(true); buzz(20); });
  renderViewBtn();
}

function nodeName(level, id) {
  if (level === 'land' || G.isHire(level)) { const t = c.towns[id]; return `${t.icon} ${t.name}`; }
  const b = c.towns[G.currentTown(s)].buildings[id] || Object.values(c.towns).map(t => t.buildings[id]).find(Boolean);
  return `${b.icon} ${b.name}`;
}

function render() {
  $('#coins-n').textContent = G.formatNumber(s.coins);
  renderViewBtn();
  const cap = G.capacity(c, s), items = [];
  for (const g in s.inv) for (let i = 0; i < s.inv[g]; i++) items.push(c.goods[g].icon);
  const bagHtml = cap <= 5
    ? Array.from({ length: cap }, (_, i) => `<span class="slot">${items[i] || ''}</span>`).join('')
    : `<span class="bagtext">${Object.entries(s.inv).map(([g, n]) => c.goods[g].icon + n).join(' ') || 'Empty'} · ${G.carried(s)}/${cap}</span>`;
  if ($('#bag').dataset.k !== bagHtml) { $('#bag').dataset.k = bagHtml; $('#bag').innerHTML = bagHtml; }

  const L = planLevel(), r = G.route(s, L);
  const key = JSON.stringify([L, r?.plan, r?.trip?.idx ?? -1, !!r?.trip, G.ordersUnlocked(c, s), G.canPlan(c, s, L), G.activeLevel(s)]);
  if (key !== planKey) { planKey = key; renderPlan(); }

  const t = G.tradingAt(s), tr = G.activeLevel(s) && G.route(s, G.activeLevel(s)).trip;
  const tk = JSON.stringify([t, tr?.atStop, tr?.manual, tr?.go, G.isWaiting(s), s.inv, s.coins, cap]);
  if (tk !== tradeKey) { tradeKey = tk; renderTrade(); }
  updateStay();

  const ik = JSON.stringify([selected, s.visited, view(), s.town, editing, r?.plan.length]);
  if (ik !== infoKey) { infoKey = ik; renderInfo(); }

  const H = editing && G.hireOf(s, editing);
  $('#route-title').textContent = H ? `${H.name}'s route (up to ${G.management(c, s).stops} towns)` : L === 'land' ? 'Land route' : `Route in ${c.towns[G.currentTown(s)].name}`;
  const ls = G.loopSeconds(c, s, L);
  $('#loop-time').textContent = ls ? `≈ ${fmtTime(ls)} per loop` : '';

  const go = $('#go'), A = G.activeLevel(s);
  go.classList.toggle('afford', !A && !!r?.plan.length && G.canPlan(c, s, L));
  go.classList.toggle('stop-btn', A === L);
  go.textContent = A === L
    ? (tr.atStop ? '■ Stop here to change the route' : tr.stopRequested ? 'Stopping at the next stop…' : '■ Stop to change the route')
    : A === 'land' ? 'On a land route. Stop it on the land map to walk this town.'
    : A === 'town' ? 'Go ▶ (leaves town, ends the walk here)'
    : r?.plan.length ? 'Go ▶ (repeats until stopped)' : (L === 'land' ? 'Tap towns to plan a route' : 'Plan a route first');
  if (A === 'town' && L === 'land') go.classList.toggle('afford', !!r.plan.length);
  $('#walk-hint').hidden = !(A === L && !tr.atStop);
  $('#clear').hidden = !G.canPlan(c, s, L) || !r?.plan.length;
  if (H) {
    go.classList.toggle('afford', !r.trip && !!r.plan.length);
    go.classList.toggle('stop-btn', !!r.trip);
    go.textContent = r.trip ? `■ Stop ${H.name}'s route` : r.plan.length ? `Send ${H.name} ▶ (repeats until stopped)` : `Tap towns to plan ${H.name}'s route`;
    $('#walk-hint').hidden = true;
  }
  const hk = JSON.stringify([editing, s.hires.map(h => [h.route.at, h.route.plan.length, h.route.trip?.idx, h.route.trip?.atStop, h.inv]), G.management(c, s), s.coins >= G.hireCost(c, s)]);
  if (hk !== hireKey) { hireKey = hk; renderHires(); }

  const uk = JSON.stringify([s.upgrades, c.upgrades.map(u => s.coins >= u.cost)]);
  if (uk !== upKey) { upKey = uk; renderUpgrades(); }
}

function renderPlan() {
  const el = $('#plan'), L = planLevel(), r = G.route(s, L);
  if (!r) { el.innerHTML = ''; return; }
  if (!r.plan.length) {
    el.innerHTML = `<p class="hint">${G.isHire(L) ? 'Tap towns on the land map to add them to this merchant\'s route. Hired merchants only trade by standing orders, so give each stop some.' : L === 'land'
      ? 'Tap a town to see what it buys and sells, then add it to your route. You can also drag your finger through towns. Tap the town you are in to go back into it.'
      : 'Tap buildings on the map in the order you want to visit them, or drag your finger through them.'}
      ${G.ordersUnlocked(c, s) ? ' Pick what to buy or sell at each stop; stops with no orders wait for you to trade by hand.' : ' The merchant stays a day at each stop so you can trade.'}</p>`;
    return;
  }
  const locked = !!r.trip || !G.canPlan(c, s, L);
  el.innerHTML = r.plan.map((st, i) => {
    const m = G.market(c, L, st.b);
    const state = r.trip ? (i < r.trip.idx ? 'done' : i === r.trip.idx ? 'now' : '') : '';
    const chips = [];
    for (const g in m.sells) chips.push(chip(i, g, 'buy', m.sells[g], st.orders[g] === 'buy', locked));
    for (const g in m.buys) chips.push(chip(i, g, 'sell', m.buys[g], st.orders[g] === 'sell', locked));
    return `<div class="stop ${state}">
      <div class="stop-head"><b class="num">${i + 1}</b><span>${nodeName(L, st.b)}</span>${locked ? '' : `<button class="rm" data-rm="${i}" aria-label="Remove stop">✕</button>`}</div>
      ${G.ordersUnlocked(c, s) ? `<div class="chips">${chips.join('')}</div>${Object.keys(st.orders).length ? '' : '<div class="nochips">No orders: the merchant waits here for you.</div>'}` : ''}</div>`;
  }).join('');
}

function chip(i, g, kind, price, on, locked) {
  const gd = c.goods[g];
  return `<button class="chip ${kind} ${on ? 'on' : ''}" data-i="${i}" data-good="${g}" ${locked ? 'disabled' : ''}>
    ${kind === 'buy' ? 'Buy' : 'Sell'} ${gd.icon} <b>${price}</b></button>`;
}

function renderTrade() {
  const el = $('#trade'), t = G.tradingAt(s);
  if (!t) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  const m = G.market(c, t.level, t.id), rows = [];
  for (const g in m.sells) {
    const can = G.maxBuy(c, s, g) > 0;
    rows.push(`<div class="trow"><span class="tg">${c.goods[g].icon} ${c.goods[g].name}</span><span class="tp">🪙 ${m.sells[g]}</span>
      <button class="tb buy1 ${can ? 'ok' : ''}" data-act="buy" data-good="${g}">Buy</button>
      <button class="tb buy1 ${can ? 'ok' : ''}" data-act="buyall" data-good="${g}">Max</button></div>`);
  }
  for (const g in m.buys) {
    const have = s.inv[g] || 0;
    rows.push(`<div class="trow"><span class="tg">${c.goods[g].icon} ${c.goods[g].name}${have ? ` <i>×${have}</i>` : ''}</span><span class="tp">🪙 ${m.buys[g]}</span>
      <button class="tb sell1 ${have ? 'ok' : ''}" data-act="sell" data-good="${g}">Sell</button>
      <button class="tb sell1 ${have ? 'ok' : ''}" data-act="sellall" data-good="${g}">All</button></div>`);
  }
  const A = G.activeLevel(s), tr = A && G.route(s, A).trip, visiting = tr?.atStop;
  el.innerHTML = `<div class="sec-head"><b>${visiting ? 'Visiting' : 'Trading at'} ${nodeName(t.level, t.id)}${t.level === 'land' ? ' market' : ''}</b></div>
    <div class="tcard">${visiting ? '<div class="day"><div class="day-bar"><i id="day-fill"></i></div><p id="stay-text"></p></div>' : ''}
    ${rows.join('') || '<p class="hint">Nothing to trade here.</p>'}
    ${visiting && tr.manual ? `<button class="btn go ${tr.go ? '' : 'afford'}" data-act="continue" id="walk-on">Walk on ▶</button>` : ''}</div>`;
  updateStay();
}

function updateStay() {
  const A = G.activeLevel(s), tr = A && G.route(s, A).trip, txt = $('#stay-text');
  if (!tr?.atStop || !txt) return;
  const left = Math.max(0, tr.stay);
  $('#day-fill').style.transform = `scaleX(${1 - left / c.dayLength})`;
  let t;
  if (!tr.manual) t = `Standing orders run at the end of the day (${Math.ceil(left)}s). Trade by hand to take over this visit.`;
  else if (tr.go) t = left > 0 ? `Leaving when the day ends (${Math.ceil(left)}s).` : 'Leaving…';
  else if (left > 0) t = `The day ends in ${Math.ceil(left)}s. Tap Walk on whenever you're done.`;
  else t = 'The day is over. Waiting for you to walk on.';
  if (txt.textContent !== t) txt.textContent = t;
  const w = $('#walk-on'); if (w) { const l = tr.go ? "Walking on at day's end" : 'Walk on ▶'; if (w.textContent !== l) w.textContent = l; }
}

function setEditing(lv) {
  editing = lv; maps.land.editing = lv;
  planKey = hireKey = infoKey = '';
  if (lv && s.view !== 'land') setView('land');
  if (lv) $('#panel').scrollTo({ top: 0, behavior: 'smooth' });
}

function renderHires() {
  const el = $('#hires'), m = G.management(c, s);
  if (!m.level) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  const cards = s.hires.map(h => {
    const lv = 'hire:' + h.id, r = h.route, tr = r.trip;
    const where = tr ? (tr.atStop ? `at ${c.towns[r.plan[tr.idx].b].name}` : `riding to ${c.towns[r.plan[tr.idx].b].name}`) : `waiting in ${c.towns[r.at].name}`;
    const cargo = Object.entries(h.inv).map(([g, n]) => c.goods[g].icon + n).join(' ') || 'empty';
    const stops = r.plan.map(p => c.towns[p.b].icon).join(' → ') || 'no route yet';
    return `<div class="hire ${editing === lv ? 'editing' : ''}">
      <div class="stop-head"><span>🧑 ${h.name}</span><small>${where}</small></div>
      <div class="hire-sub">${stops} · cargo ${cargo}</div>
      <div class="btnrow"><button class="btn" data-h="edit" data-lv="${lv}">${editing === lv ? 'Done editing' : 'Edit route'}</button>
        ${tr ? `<button class="btn stop-btn" data-h="stop" data-lv="${lv}">Stop</button>` : `<button class="btn ${r.plan.length ? 'afford' : ''}" data-h="start" data-lv="${lv}">Send ▶</button>`}</div></div>`;
  }).join('');
  const full = s.hires.length >= m.hires, cost = G.hireCost(c, s);
  el.innerHTML = `<div class="sec-head"><b>Merchants ${s.hires.length}/${m.hires}</b></div>${cards}
    ${full ? '<p class="hint">Raise your Management skill to hire more.</p>' : `<div class="up"><div class="up-icon">🧑</div><div class="up-text"><b>Hire a merchant</b><span>Starts in the town you're in, carries 15 goods, rides on standing orders.</span></div>
      <button class="buy ${s.coins >= cost ? 'afford' : ''}" data-h="hire">HIRE · 🪙 ${G.formatNumber(cost)}</button></div>`}`;
}

// Land map: the card for a tapped town, with price estimates.
function renderInfo() {
  const el = $('#info');
  if (view() !== 'land' || !selected) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  const t = c.towns[selected], m = G.market(c, 'land', selected), rows = [];
  const fmt = e => e.exact ? `${e.lo}` : `${e.lo}–${e.hi}`;
  for (const g in m.sells) rows.push(`<span class="ig buy">${c.goods[g].icon} ${fmt(G.priceEstimate(c, s, selected, g, 'buy'))}</span>`);
  const sells = [];
  for (const g in m.buys) sells.push(`<span class="ig sell">${c.goods[g].icon} ${fmt(G.priceEstimate(c, s, selected, g, 'sell'))}</span>`);
  const exact = !!s.visited[selected];
  const here = selected === s.town;
  el.innerHTML = `<div class="tcard info">
    <div class="stop-head"><span>${t.icon} ${t.name}</span><button class="rm" data-info="close" aria-label="Close">✕</button></div>
    <p class="small-left">${exact ? 'Prices from your visit.' : 'Rough estimates. Visit to learn the exact prices.'}</p>
    <div class="irow"><b>Sells to you</b>${rows.join('') || '<span class="ig none">nothing</span>'}</div>
    <div class="irow"><b>Buys from you</b>${sells.join('') || '<span class="ig none">nothing</span>'}</div>
    <div class="btnrow">${here && !G.activeLevel(s) ? '<button class="btn" data-info="enter">Enter town</button>' : ''}
      <button class="btn ${G.canPlan(c, s, planLevel()) ? 'afford' : ''}" data-info="add">${editing ? `Add to ${G.hireOf(s, editing).name}'s route` : 'Add to route'}</button></div></div>`;
}

function renderUpgrades() {
  $('#upgrades').innerHTML = c.upgrades.filter(u => G.upgradeVisible(c, s, u)).map(u => {
    const owned = s.upgrades[u.id];
    return `<div class="up ${owned ? 'owned' : ''}">
      <div class="up-icon">${u.icon}</div>
      <div class="up-text"><b>${u.name}</b><span>${u.desc}</span></div>
      <button class="buy ${!owned && s.coins >= u.cost ? 'afford' : ''}" data-buy="${u.id}" ${owned ? 'disabled' : ''}>
        ${owned ? 'OWNED' : `BUY · 🪙 ${G.formatNumber(u.cost)}`}</button>
    </div>`;
  }).join('');
}

// ---------- menu ----------

function bindMenu() {
  const menu = $('#menu');
  onPress($('#menu-btn'), () => { menu.hidden = false; sfx.tap(); refreshMenu(); });
  onPress($('#menu-close'), () => { menu.hidden = true; sfx.tap(); });
  $('#build').textContent = BUILD;
  const snd = $('#opt-sound'), hap = $('#opt-haptics');
  snd.checked = fxSettings.sound; hap.checked = fxSettings.haptics;
  snd.onchange = () => { fxSettings.sound = snd.checked; S.writeSettings(fxSettings); };
  hap.onchange = () => { fxSettings.haptics = hap.checked; S.writeSettings(fxSettings); };

  const box = $('#save-box'), msg = $('#save-msg');
  const resetKeys = () => { planKey = upKey = tradeKey = infoKey = ''; selected = null; renderViewBtn(); };
  onPress($('#export'), async () => {
    save(); box.value = G.serialize(s); box.select();
    try { await navigator.clipboard.writeText(box.value); msg.textContent = 'Save copied to clipboard.'; }
    catch { msg.textContent = 'Save is in the box above. Copy it somewhere safe.'; }
  });
  onPress($('#import'), () => {
    try { s = G.deserialize(c, box.value.trim()); save(); setEditing(null); resetKeys(); msg.textContent = 'Save loaded.'; sfx.unlock(); }
    catch { msg.textContent = 'That text is not a valid save.'; sfx.deny(); }
  });
  let armed = false;
  const reset = $('#reset');
  onPress(reset, () => {
    if (!armed) { armed = true; reset.textContent = 'Tap again to erase everything'; setTimeout(() => { armed = false; reset.textContent = 'Reset game'; }, 3000); return; }
    S.clearSave(); s = G.createState(c); save(); setEditing(null); resetKeys();
    armed = false; reset.textContent = 'Reset game'; menu.hidden = true;
  });
  onPress($('#update'), async () => {
    $('#update').textContent = 'Updating…'; save();
    try { const reg = await navigator.serviceWorker?.getRegistration(); if (reg) await reg.update(); } catch {}
    location.reload();
  });
}

function refreshMenu() {
  $('#stat-earned').textContent = G.formatNumber(s.stats.earned);
  $('#stat-trips').textContent = G.formatNumber(s.stats.trips);
  $('#stat-taps').textContent = G.formatNumber(s.stats.taps);
  $('#achievements').innerHTML = Object.entries(c.achievements).map(([id, a]) =>
    `<div class="ach ${s.achievements[id] ? 'got' : ''}"><b>${s.achievements[id] ? '🏆' : '🔒'} ${a.name}</b><span>${s.achievements[id] ? a.desc : '???'}</span></div>`).join('');
  $('#save-msg').textContent = '';
}

function onPress(el, fn) {
  el.addEventListener('pointerdown', e => { if (e.button && e.button !== 0) return; e.preventDefault(); fn(e.clientX, e.clientY); });
  el.addEventListener('click', e => e.preventDefault());
}
