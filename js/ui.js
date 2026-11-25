// DOM layer for the town stage: turns touches into town.js calls and plays effects.
import * as T from './town.js';
import * as S from './storage.js';
import { sfx, buzz, floatText, burst, pulse, fxSettings } from './fx.js';
import { TownMap } from './townmap.js';

export const BUILD = '0.3.0';

const $ = sel => document.querySelector(sel);
let c, s, map;
let planKey = '', upKey = '';

export async function start() {
  c = await (await fetch('data/town.json', { cache: 'no-cache' })).json();
  Object.assign(fxSettings, S.loadSettings());
  s = T.createState(c);
  const saved = S.loadSave();
  if (saved) { try { s = T.deserialize(c, saved); } catch (e) { console.warn('Bad save, starting fresh', e); } }
  T.applyOffline(c, s, (Date.now() - s.lastSeen) / 1000);

  map = new TownMap($('#map'), c, () => s);
  bindMap();
  bindPanel();
  bindMenu();

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
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
  window.addEventListener('pagehide', save);
}

function save() { s.lastSeen = Date.now(); S.writeSave(T.serialize(s)); }

// ---------- map input: tap/trace to plan, tap to hurry ----------

function bindMap() {
  const cv = $('#map');
  let tracing = false;
  cv.addEventListener('pointerdown', e => {
    e.preventDefault();
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
    if (ev.type === 'arrive') { map.poke(ev.b); buzz(8); }
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
    if (s.trip) return;
    if (T.startTrip(s)) { sfx.unlock(); buzz(12); pulse($('#go'), 'squish'); }
    else { sfx.deny(); pulse($('#go'), 'shake'); }
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
  const key = JSON.stringify([s.plan, s.trip?.idx ?? -1, !!s.trip, s.plan.map(st => prices(st.b))]);
  if (key !== planKey) { planKey = key; renderPlan(); }

  const go = $('#go');
  go.classList.toggle('afford', !s.trip && s.plan.length > 0);
  go.textContent = s.trip ? 'Walking… tap the map to hurry' : s.plan.length ? 'Go ▶' : 'Plan a route first';
  $('#clear').hidden = !!s.trip || !s.plan.length;

  const uk = JSON.stringify([s.upgrades, s.coins >= 0 && c.upgrades.map(u => s.coins >= u.cost)]);
  if (uk !== upKey) { upKey = uk; renderUpgrades(); }
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
      Then pick what to buy <span class="g">🟢</span> or sell <span class="y">🟡</span> at each stop.</p>`;
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
      <div class="chips">${chips.join('')}</div></div>`;
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
