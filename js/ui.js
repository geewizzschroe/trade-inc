// DOM layer for the town stage: turns touches into town.js calls and plays effects.
import * as T from './town.js';
import * as S from './storage.js';
import { sfx, buzz, floatText, burst, pulse, fxSettings } from './fx.js';
import { TownMap } from './townmap.js';

export const BUILD = '0.6.0';

const $ = sel => document.querySelector(sel);
let c, s, map;
let planKey = '', upKey = '', tradeKey = '';

export async function start() {
  c = await (await fetch('data/town.json', { cache: 'no-cache' })).json();
  Object.assign(fxSettings, S.loadSettings());
  s = T.createState(c);
  const saved = S.loadSave();
  if (saved) { try { s = T.deserialize(c, saved); } catch (e) { console.warn('Bad save, starting fresh', e); } }

  map = new TownMap($('#map'), c, () => s);
  bindMap();
  bindPanel();
  bindMenu();
  catchUp();

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.25, (now - last) / 1000); last = now;
    handle(T.tick(c, s, dt));
    render();
    map.draw(dt, now);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  setInterval(save, 5000);
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); else catchUp(); });
  window.addEventListener('pagehide', save);
}

function save() { s.lastSeen = Date.now(); S.writeSave(T.serialize(s)); }

// Run the time the app was closed or in the background.
function catchUp() {
  const secs = (Date.now() - s.lastSeen) / 1000;
  s.lastSeen = Date.now();
  if (secs < 3) return;
  const looping = !!s.trip;
  const gained = T.applyOffline(c, s, secs);
  if (looping && gained > 0 && secs > 20) {
    $('#away-time').textContent = fmtTime(secs);
    $('#away-n').textContent = T.formatNumber(gained);
    $('#away').hidden = false;
  }
  save();
}

function fmtTime(sec) {
  if (sec < 60) return Math.round(sec) + 's';
  if (sec < 3600) return Math.floor(sec / 60) + 'm';
  return Math.floor(sec / 3600) + 'h ' + Math.floor((sec % 3600) / 60) + 'm';
}

// ---------- map input: tap/trace to plan, tap to hurry ----------

function bindMap() {
  const cv = $('#map');
  let tracing = false;
  cv.addEventListener('pointerdown', e => {
    e.preventDefault();
    if (s.trip?.atStop) { pulse($('#trade'), 'shake'); sfx.deny(); return; }
    if (s.trip) {
      if (T.hurry(c, s)) { sfx.tap(); buzz(6); map.puff(); floatText(e.clientX, e.clientY - 10, '»', 'tap'); }
      return;
    }
    tracing = true;
    cv.setPointerCapture?.(e.pointerId);
    addStop(map.hitBuilding(e.clientX, e.clientY));
  });
  cv.addEventListener('pointermove', e => {
    if (!tracing || s.trip) return;
    const b = map.hitBuilding(e.clientX, e.clientY);
    if (b) addStop(b);
  });
  const end = () => { tracing = false; };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
}

function addStop(b) {
  if (!b) return;
  if (T.planAdd(c, s, b)) {
    sfx.tap(); buzz(5); map.poke(b);
    const [x, y] = map.buildingPagePos(b);
    floatText(x, y - 30, String(s.plan.length), 'tap');
  }
}

// ---------- events from the simulation ----------

function handle(events) {
  for (const ev of events) {
    if (ev.type === 'arrive') {
      map.poke(ev.b); buzz(8);
      if (!ev.auto) sfx.unlock();
      $('#panel').scrollTo({ top: 0, behavior: 'smooth' });
    }
    else if (ev.type === 'sell') {
      const [x, y] = map.buildingPagePos(ev.b);
      floatText(x, y - 20, `+${ev.coins} 🪙`, 'coin');
      burst(x, y, Math.min(10, 3 + ev.n), '🪙');
      sfx.coin(true); pulse($('#coins'), 'bump');
    } else if (ev.type === 'buy') {
      const [x, y] = map.buildingPagePos(ev.b);
      floatText(x + 20, y - 4, `+${ev.n} ${c.goods[ev.good].icon}`, 'hire');
      sfx.hire(); pulse($('#bag'), 'bump');
    } else if (ev.type === 'done') {
      const [x, y] = map.merchantPagePos();
      if (ev.profit !== 0) floatText(x, y - 50, (ev.profit > 0 ? 'Route profit +' : 'Route ') + ev.profit, ev.profit > 0 ? 'milestone' : 'tap');
      sfx.unlock(); buzz([10, 30, 10]);
      save();
    } else if (ev.type === 'achievement') showAchievement(ev.id);
  }
}

function showAchievement(id) {
  const a = c.achievements[id];
  const el = $('#toast');
  el.innerHTML = `<b>🏆 ${a.name}</b><span>${a.desc}</span>`;
  el.hidden = false; pulse(el, 'toast-in');
  sfx.milestone(); buzz([20, 50, 20, 50, 40]);
  clearTimeout(showAchievement.t);
  showAchievement.t = setTimeout(() => { el.hidden = true; }, 3500);
}

// ---------- panel: route plan, bag, upgrades ----------

function bindPanel() {
  onPress($('#go'), () => {
    if (s.trip) { if (T.requestStop(s)) { sfx.tap(); buzz(8); pulse($('#go'), 'squish'); } return; }
    if (T.startTrip(s)) { sfx.unlock(); buzz(12); pulse($('#go'), 'squish'); }
    else { sfx.deny(); pulse($('#go'), 'shake'); }
  });
  $('#trade').addEventListener('pointerdown', e => {
    const btn = e.target.closest('[data-act]'); if (!btn) return;
    e.preventDefault();
    const g = btn.dataset.good, act = btn.dataset.act;
    if (act === 'continue') { if (T.continueTrip(c, s)) { sfx.tap(); buzz(8); } return; }
    const n = act.endsWith('all') ? 1e9 : 1;
    const ev = act.startsWith('buy') ? T.tradeBuy(c, s, g, n) : T.tradeSell(c, s, g, n);
    if (!ev) { sfx.deny(); pulse(btn, 'shake'); return; }
    const r = btn.getBoundingClientRect();
    if (ev.type === 'sell') { floatText(r.left + r.width / 2, r.top, `+${ev.coins} 🪙`, 'coin'); burst(r.left + r.width / 2, r.top, Math.min(10, 2 + ev.n)); sfx.coin(true); pulse($('#coins'), 'bump'); }
    else { floatText(r.left + r.width / 2, r.top, `+${ev.n} ${c.goods[g].icon}`, 'hire'); sfx.hire(); pulse($('#bag'), 'bump'); }
    buzz(8); pulse(btn, 'squish');
  });
  onPress($('#clear'), () => { if (!s.trip && s.plan.length) { T.planClear(s); sfx.tap(); } });
  // stop rows and upgrade buttons are rebuilt, so listen on the containers
  $('#plan').addEventListener('pointerdown', e => {
    const chip = e.target.closest('[data-good]'), rm = e.target.closest('[data-rm]');
    if (chip) { e.preventDefault(); T.toggleOrder(c, s, +chip.dataset.i, chip.dataset.good); sfx.tap(); buzz(4); }
    else if (rm) { e.preventDefault(); T.planRemove(s, +rm.dataset.rm); sfx.tap(); }
  });
  $('#upgrades').addEventListener('pointerdown', e => {
    const btn = e.target.closest('[data-buy]'); if (!btn) return;
    e.preventDefault();
    const evs = T.buyUpgrade(c, s, btn.dataset.buy);
    if (!evs) { sfx.deny(); pulse(btn, 'shake'); return; }
    const r = btn.getBoundingClientRect();
    burst(r.left + r.width / 2, r.top, 14, '✨'); sfx.unlock(); buzz([10, 40, 20]);
    handle(evs);
    if (btn.dataset.buy === 'horse') setTimeout(() => { $('#beyond').hidden = false; }, 600);
    save();
  });
  onPress($('#away-ok'), (x, y) => { $('#away').hidden = true; burst(x, y, 16); sfx.coin(true); buzz(20); });
  onPress($('#beyond-ok'), () => { $('#beyond').hidden = true; sfx.tap(); });
}

function render() {
  $('#coins-n').textContent = T.formatNumber(s.coins);
  // bag slots
  const cap = T.capacity(c, s), items = [];
  for (const g in s.inv) for (let i = 0; i < s.inv[g]; i++) items.push(c.goods[g].icon);
  const bagHtml = Array.from({ length: cap }, (_, i) => `<span class="slot">${items[i] || ''}</span>`).join('');
  if ($('#bag').dataset.k !== bagHtml) { $('#bag').dataset.k = bagHtml; $('#bag').innerHTML = bagHtml; }

  // plan rows (rebuilt only when something visible changed)
  const key = JSON.stringify([s.plan, s.trip?.idx ?? -1, !!s.trip, s.plan.map(st => prices(st.b)), T.ordersUnlocked(c, s)]);
  if (key !== planKey) { planKey = key; renderPlan(); }

  const tk = JSON.stringify([T.tradingAt(s), s.trip?.atStop, s.trip?.manual, s.trip?.go, T.isWaiting(s), s.inv, s.coins, T.capacity(c, s)]);
  if (tk !== tradeKey) { tradeKey = tk; renderTrade(); }
  updateStay();
  const ls = T.loopSeconds(c, s);
  $('#loop-time').textContent = s.plan.length ? `≈ ${fmtTime(ls)} per loop` : '';

  const go = $('#go');
  go.classList.toggle('afford', !s.trip && s.plan.length > 0);
  go.classList.toggle('stop-btn', !!s.trip);
  go.textContent = s.trip ? (s.trip.atStop ? '■ Stop here to change the route' : s.trip.stopRequested ? 'Stopping at the next building…' : '■ Stop to change the route')
    : s.plan.length ? 'Go ▶ (repeats until stopped)' : 'Plan a route first';
  $('#walk-hint').hidden = !s.trip || !!s.trip.atStop;
  $('#clear').hidden = !!s.trip || !s.plan.length;

  const uk = JSON.stringify([s.upgrades, s.coins >= 0 && c.upgrades.map(u => s.coins >= u.cost)]);
  if (uk !== upKey) { upKey = uk; renderUpgrades(); }
}

function renderTrade() {
  const el = $('#trade'), b = T.tradingAt(s);
  if (c.stopMode !== 'manual' || !b) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  const d = c.buildings[b], rows = [];
  for (const g in d.sells) {
    const p = T.buyPrice(c, s, b, g), can = T.maxBuy(c, s, g) > 0;
    rows.push(`<div class="trow"><span class="tg">${c.goods[g].icon} ${c.goods[g].name}</span><span class="tp buyp">🪙 ${p}</span>
      <button class="tb buy1 ${can ? 'ok' : ''}" data-act="buy" data-good="${g}">Buy</button>
      <button class="tb buy1 ${can ? 'ok' : ''}" data-act="buyall" data-good="${g}">Max</button></div>`);
  }
  for (const g in d.buys) {
    const p = T.sellPrice(c, s, b, g), have = s.inv[g] || 0;
    rows.push(`<div class="trow"><span class="tg">${c.goods[g].icon} ${c.goods[g].name}${have ? ` <i>×${have}</i>` : ''}</span><span class="tp sellp">🪙 ${p}</span>
      <button class="tb sell1 ${have ? 'ok' : ''}" data-act="sell" data-good="${g}">Sell</button>
      <button class="tb sell1 ${have ? 'ok' : ''}" data-act="sellall" data-good="${g}">All</button></div>`);
  }
  const tr = s.trip, visiting = tr?.atStop;
  el.innerHTML = `<div class="sec-head"><b>${visiting ? 'Visiting' : 'Trading at'} ${d.icon} ${d.name}</b></div>
    <div class="tcard">${visiting ? '<div class="day"><div class="day-bar"><i id="day-fill"></i></div><p id="stay-text"></p></div>' : ''}
    ${rows.join('') || '<p class="hint">Nothing to trade here.</p>'}
    ${visiting && tr.manual ? `<button class="btn go ${tr.go ? '' : 'afford'}" data-act="continue" id="walk-on">Walk on ▶</button>` : ''}</div>`;
  updateStay();
}

// Per-frame text for the current visit's day.
function updateStay() {
  const tr = s.trip, txt = $('#stay-text');
  if (!tr?.atStop || !txt) return;
  const left = Math.max(0, tr.stay);
  $('#day-fill').style.transform = `scaleX(${1 - left / c.dayLength})`;
  let t;
  if (!tr.manual) t = `Standing orders run at the end of the day (${Math.ceil(left)}s). Trade by hand to take over this visit.`;
  else if (tr.go) t = left > 0 ? `Leaving when the day ends (${Math.ceil(left)}s).` : 'Leaving…';
  else if (left > 0) t = `The day ends in ${Math.ceil(left)}s. Tap Walk on whenever you're done.`;
  else t = 'The day is over. Waiting for you to walk on.';
  if (txt.textContent !== t) txt.textContent = t;
  const w = $('#walk-on'); if (w) { const l = tr.go ? 'Walking on at day\'s end' : 'Walk on ▶'; if (w.textContent !== l) w.textContent = l; }
}

function prices(b) {
  const d = c.buildings[b], out = [];
  for (const g in d.sells) out.push(T.buyPrice(c, s, b, g));
  for (const g in d.buys) out.push(T.sellPrice(c, s, b, g));
  return out.join(',');
}

function renderPlan() {
  const el = $('#plan');
  if (!s.plan.length) {
    el.innerHTML = `<p class="hint">Tap buildings on the map in the order you want to visit them, or drag your finger through them.
      ${T.ordersUnlocked(c, s) ? 'Then pick what to buy or sell at each stop. Stops with no orders wait for you to trade by hand.' : 'The merchant will stop at each one so you can trade.'}</p>`;
    return;
  }
  el.innerHTML = s.plan.map((st, i) => {
    const d = c.buildings[st.b];
    const state = s.trip ? (i < s.trip.idx ? 'done' : i === s.trip.idx ? 'now' : '') : '';
    const chips = [];
    for (const g in d.sells) chips.push(chip(i, g, 'buy', T.buyPrice(c, s, st.b, g), st.orders[g] === 'buy'));
    for (const g in d.buys) chips.push(chip(i, g, 'sell', T.sellPrice(c, s, st.b, g), st.orders[g] === 'sell'));
    return `<div class="stop ${state}">
      <div class="stop-head"><b class="num">${i + 1}</b><span>${d.icon} ${d.name}</span>${s.trip ? '' : `<button class="rm" data-rm="${i}" aria-label="Remove stop">✕</button>`}</div>
      ${T.ordersUnlocked(c, s) ? `<div class="chips">${chips.join('')}</div>${Object.keys(st.orders).length ? '' : '<div class="nochips">No orders: the merchant waits here for you.</div>'}` : ''}</div>`;
  }).join('');
}

function chip(i, g, kind, price, on) {
  const gd = c.goods[g];
  return `<button class="chip ${kind} ${on ? 'on' : ''}" data-i="${i}" data-good="${g}" ${s.trip ? 'disabled' : ''}>
    ${kind === 'buy' ? 'Buy' : 'Sell'} ${gd.icon} <b>${price}</b></button>`;
}

function renderUpgrades() {
  $('#upgrades').innerHTML = c.upgrades.map(u => {
    const owned = s.upgrades[u.id];
    return `<div class="up ${owned ? 'owned' : ''}">
      <div class="up-icon">${u.icon}</div>
      <div class="up-text"><b>${u.name}</b><span>${u.desc}</span></div>
      <button class="buy ${!owned && s.coins >= u.cost ? 'afford' : ''}" data-buy="${u.id}" ${owned ? 'disabled' : ''}>
        ${owned ? 'OWNED' : `BUY · 🪙 ${T.formatNumber(u.cost)}`}</button>
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
  onPress($('#export'), async () => {
    save(); box.value = T.serialize(s); box.select();
    try { await navigator.clipboard.writeText(box.value); msg.textContent = 'Save copied to clipboard.'; }
    catch { msg.textContent = 'Save is in the box above. Copy it somewhere safe.'; }
  });
  onPress($('#import'), () => {
    try { s = T.deserialize(c, box.value.trim()); save(); planKey = upKey = ''; msg.textContent = 'Save loaded.'; sfx.unlock(); }
    catch { msg.textContent = 'That text is not a valid save.'; sfx.deny(); }
  });
  let armed = false;
  const reset = $('#reset');
  onPress(reset, () => {
    if (!armed) { armed = true; reset.textContent = 'Tap again to erase everything'; setTimeout(() => { armed = false; reset.textContent = 'Reset game'; }, 3000); return; }
    S.clearSave(); s = T.createState(c); save(); planKey = upKey = '';
    armed = false; reset.textContent = 'Reset game'; menu.hidden = true;
  });
  onPress($('#update'), async () => {
    $('#update').textContent = 'Updating…'; save();
    try { const reg = await navigator.serviceWorker?.getRegistration(); if (reg) await reg.update(); } catch {}
    location.reload();
  });
}

function refreshMenu() {
  $('#stat-earned').textContent = T.formatNumber(s.stats.earned);
  $('#stat-trips').textContent = T.formatNumber(s.stats.trips);
  $('#stat-taps').textContent = T.formatNumber(s.stats.taps);
  $('#achievements').innerHTML = Object.entries(c.achievements).map(([id, a]) =>
    `<div class="ach ${s.achievements[id] ? 'got' : ''}"><b>${s.achievements[id] ? '🏆' : '🔒'} ${a.name}</b><span>${s.achievements[id] ? a.desc : '???'}</span></div>`).join('');
  $('#save-msg').textContent = '';
}

function onPress(el, fn) {
  el.addEventListener('pointerdown', e => { if (e.button && e.button !== 0) return; e.preventDefault(); fn(e.clientX, e.clientY); });
  el.addEventListener('click', e => e.preventDefault());
}
