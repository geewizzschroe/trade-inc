// DOM layer: renders state, turns touches into engine calls, triggers effects.
import * as E from './engine.js';
import * as S from './storage.js';
import { sfx, buzz, floatText, burst, pulse, fxSettings } from './fx.js';

export const BUILD = '0.1.0';

const $ = sel => document.querySelector(sel);
let content, state, buyMode = 1;
const cards = {};

export async function start() {
  content = await (await fetch('data/content.json', { cache: 'no-cache' })).json();
  Object.assign(fxSettings, S.loadSettings());

  const saved = S.loadSave();
  state = E.createState(content);
  if (saved) { try { state = E.deserialize(content, saved); } catch (e) { console.warn('Bad save, starting fresh', e); } }

  buildRoutes();
  bindChrome();
  catchUp((Date.now() - state.lastSeen) / 1000);

  let last = performance.now();
  function frame(now) {
    const dt = (now - last) / 1000; last = now;
    if (dt > 2) catchUp(dt); // tab was asleep
    else step(Math.max(0, dt));
    render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  setInterval(save, 5000);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) save();
    else catchUp((Date.now() - state.lastSeen) / 1000);
  });
  window.addEventListener('pagehide', save);
}

function save() {
  state.lastSeen = Date.now();
  S.writeSave(E.serialize(state));
}

function catchUp(seconds) {
  state.lastSeen = Date.now();
  if (seconds < 5) return;
  const earned = E.applyOffline(content, state, seconds);
  if (earned > 0) showAway(seconds, earned);
}

function step(dt) {
  for (const ev of E.tick(content, state, dt)) onArrive(ev);
}

// ---------- building the route cards ----------

function buildRoutes() {
  const list = $('#routes');
  list.innerHTML = '';
  for (const def of content.routes) {
    const el = document.createElement('section');
    el.className = 'route';
    el.innerHTML = `
      <div class="lock">
        <div class="lock-icon">${def.icon}</div>
        <div class="lock-text"><b>${def.good} route</b><span>${def.from} → ${def.to}</span></div>
        <button class="btn unlock-btn"><span>Open route</span><b class="cost"></b></button>
      </div>
      <div class="live">
        <div class="row top">
          <div class="icon">${def.icon}</div>
          <div class="title"><b>${def.good}</b><span>${def.from} → ${def.to}</span></div>
          <div class="owned"><b class="n">0</b><span>caravans</span></div>
        </div>
        <button class="track" aria-label="Send ${def.good} caravan">
          <div class="fill"></div>
          <div class="cart">🐫</div>
          <div class="track-label"></div>
        </button>
        <div class="row bottom">
          <div class="info"><span class="per"></span><span class="ms"></span></div>
          <button class="btn hire-btn"><span class="hire-label">Hire</span><b class="cost"></b></button>
        </div>
      </div>`;
    list.appendChild(el);
    const c = cards[def.id] = {
      el, def,
      track: el.querySelector('.track'), fill: el.querySelector('.fill'), cart: el.querySelector('.cart'),
      trackLabel: el.querySelector('.track-label'), owned: el.querySelector('.owned .n'),
      per: el.querySelector('.per'), ms: el.querySelector('.ms'),
      hire: el.querySelector('.hire-btn'), hireLabel: el.querySelector('.hire-label'), hireCost: el.querySelector('.hire-btn .cost'),
      unlock: el.querySelector('.unlock-btn'), unlockCost: el.querySelector('.unlock-btn .cost'),
      cache: {},
    };
    c.unlockCost.textContent = '🪙 ' + E.formatNumber(def.unlockCost);

    onPress(c.track, (x, y) => {
      const res = E.tap(content, state, def.id);
      if (!res) return;
      sfx.tap(); buzz(6);
      pulse(c.track, 'squish');
      floatText(x, y - 10, res === 'started' ? 'Go!' : '»', 'tap');
    });
    onPress(c.hire, (x, y) => {
      const n = hireCount(def);
      const before = state.routes[def.id].caravans;
      if (n > 0 && E.hire(content, state, def.id, n)) {
        const after = state.routes[def.id].caravans;
        sfx.hire(); buzz(12);
        pulse(c.hire, 'squish');
        burst(x, y, 4, '🐫');
        floatText(x, y - 20, '+' + n + ' 🐫', 'hire');
        if (E.milestonesReached(content, after) > E.milestonesReached(content, before)) celebrateMilestone(c);
        pulse(c.owned, 'bump');
      } else { sfx.deny(); pulse(c.hire, 'shake'); }
    });
    onPress(c.unlock, (x, y) => {
      if (E.unlock(content, state, def.id)) {
        sfx.unlock(); buzz([10, 40, 20]);
        burst(x, y, 12, '✨');
        pulse(el, 'reveal');
      } else { sfx.deny(); pulse(c.unlock, 'shake'); }
    });
  }
}

function hireCount(def) {
  const rs = state.routes[def.id];
  if (buyMode === 'max') return E.maxAffordable(def, rs.caravans, state.coins);
  return buyMode;
}

function celebrateMilestone(c) {
  sfx.milestone(); buzz([20, 50, 20, 50, 40]);
  const r = c.el.getBoundingClientRect();
  floatText(r.left + r.width / 2, r.top + 20, 'Speed ×' + content.milestoneSpeedMult + '!', 'milestone');
  burst(r.left + r.width / 2, r.top + 30, 14, '⭐');
  pulse(c.el, 'glow');
}

function onArrive(ev) {
  const c = cards[ev.routeId];
  const r = c.track.getBoundingClientRect();
  const manual = state.routes[ev.routeId].caravans === 0;
  const fast = E.tripTime(content, c.def, state.routes[ev.routeId]) < 0.4;
  const cx = r.left + r.width * (fast ? 0.5 + Math.random() * 0.4 : 0.85);
  if (!fast || Math.random() < 0.15) floatText(cx, r.top + 6, '+' + E.formatNumber(ev.amount), 'coin');
  if (manual) { burst(r.right - 20, r.top + r.height / 2, 5); buzz(15); }
  sfx.coin(manual);
  pulse($('#coins'), 'bump');
}

// ---------- per-frame rendering ----------

function set(c, key, el, prop, value) {
  if (c.cache[key] !== value) { c.cache[key] = value; el[prop] = value; }
}

function render() {
  $('#coins-n').textContent = E.formatNumber(state.coins);
  const ips = E.incomePerSecond(content, state);
  $('#ips').textContent = ips > 0 ? '+' + E.formatNumber(ips) + ' / sec' : 'Tap a route to send a caravan';

  let shownLocked = false;
  for (const def of content.routes) {
    const c = cards[def.id], rs = state.routes[def.id];
    // Show unlocked routes, plus only the next locked one, so there is always one goal in view.
    let mode = rs.unlocked ? 'live' : (!shownLocked ? 'locked' : 'hidden');
    if (!rs.unlocked) shownLocked = true;
    if (c.cache.mode !== mode) { c.cache.mode = mode; c.el.dataset.mode = mode; }
    if (mode === 'hidden') continue;
    if (mode === 'locked') {
      c.unlock.classList.toggle('afford', state.coins >= def.unlockCost);
      continue;
    }
    const T = E.tripTime(content, def, rs);
    const fast = T < 0.4 && rs.caravans > 0;
    const p = fast ? 1 : rs.progress;
    c.fill.style.transform = `scaleX(${p})`;
    c.cart.style.left = `calc(${p * 100}% - ${p * 28}px)`;
    c.track.classList.toggle('fast', fast);
    c.track.classList.toggle('idle', !rs.running);
    set(c, 'tl', c.trackLabel, 'textContent',
      !rs.running ? 'Tap to send · 🪙 ' + E.formatNumber(E.payoutPerTrip(def, rs))
      : '🪙 ' + E.formatNumber(E.payoutPerTrip(def, rs)) + ' · ' + E.formatTime(T));
    set(c, 'own', c.owned, 'textContent', String(rs.caravans));
    set(c, 'per', c.per, 'textContent', rs.caravans ? E.formatNumber(E.payoutPerTrip(def, rs) / T) + ' / sec' : 'Hire a caravan to automate');
    const nm = E.nextMilestone(content, rs.caravans);
    set(c, 'ms', c.ms, 'textContent', nm ? `Speed ×${content.milestoneSpeedMult} at ${nm}` : 'Max speed');

    const n = hireCount(def);
    const cost = n > 0 ? E.caravanCost(def, rs.caravans, n) : E.caravanCost(def, rs.caravans, 1);
    set(c, 'hl', c.hireLabel, 'textContent', buyMode === 'max' ? `Hire ×${n}` : (buyMode === 1 ? 'Hire' : `Hire ×${buyMode}`));
    set(c, 'hc', c.hireCost, 'textContent', '🪙 ' + E.formatNumber(cost));
    c.hire.classList.toggle('afford', n > 0 && state.coins >= cost);
  }
}

// ---------- menu, buy mode, away popup ----------

function bindChrome() {
  const modes = [1, 10, 'max'];
  const modeBtn = $('#buymode');
  const label = () => modeBtn.textContent = buyMode === 'max' ? 'Buy Max' : 'Buy ×' + buyMode;
  label();
  onPress(modeBtn, () => { buyMode = modes[(modes.indexOf(buyMode) + 1) % modes.length]; label(); sfx.tap(); buzz(5); pulse(modeBtn, 'squish'); });

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
    save();
    box.value = E.serialize(state);
    box.select();
    try { await navigator.clipboard.writeText(box.value); msg.textContent = 'Save copied to clipboard.'; }
    catch { msg.textContent = 'Save is in the box above. Copy it somewhere safe.'; }
  });
  onPress($('#import'), () => {
    try {
      state = E.deserialize(content, box.value.trim());
      state.lastSeen = Date.now();
      save(); resetCaches();
      msg.textContent = 'Save loaded.';
      sfx.unlock();
    } catch { msg.textContent = 'That text is not a valid save.'; sfx.deny(); }
  });
  let armed = false;
  const reset = $('#reset');
  onPress(reset, () => {
    if (!armed) { armed = true; reset.textContent = 'Tap again to erase everything'; setTimeout(() => { armed = false; reset.textContent = 'Reset game'; }, 3000); return; }
    S.clearSave(); state = E.createState(content); save(); resetCaches();
    armed = false; reset.textContent = 'Reset game'; menu.hidden = true;
  });

  onPress($('#away-ok'), (x, y) => { $('#away').hidden = true; burst(x, y, 16); sfx.coin(true); buzz(20); });
}

function refreshMenu() {
  $('#stat-earned').textContent = E.formatNumber(state.stats.totalEarned);
  $('#stat-trips').textContent = E.formatNumber(state.stats.trips);
  $('#stat-taps').textContent = E.formatNumber(state.stats.taps);
  $('#save-msg').textContent = '';
}

function resetCaches() { for (const id in cards) cards[id].cache = {}; }

function showAway(seconds, earned) {
  $('#away-time').textContent = E.formatTime(seconds);
  $('#away-n').textContent = E.formatNumber(earned);
  $('#away').hidden = false;
}

// Fires on touch/pointer down for snappy feel, with the touch position.
function onPress(el, fn) {
  el.addEventListener('pointerdown', e => {
    if (e.button && e.button !== 0) return;
    e.preventDefault();
    fn(e.clientX, e.clientY);
  });
  el.addEventListener('click', e => e.preventDefault());
}
