// Pure logic for the town stage: one merchant, buildings that buy and sell, a planned route.
// No DOM, timers or storage. The UI calls these and reacts to the returned events.

export const SAVE_VERSION = 1;

export function createState(c) {
  return {
    saveVersion: SAVE_VERSION,
    coins: c.startCoins,
    at: c.startAt,             // building the merchant is standing at (null while walking)
    pos: { x: c.buildings[c.startAt].x, y: c.buildings[c.startAt].y },
    inv: {},
    upgrades: {},
    achievements: {},
    priceMult: {},             // building -> good -> { buy, sell } multipliers (1 = base price)
    plan: [],                  // [{ b, orders: { good: 'buy' | 'sell' } }]
    trip: null,                // { idx, from, leg: distance walked, pause, startCoins }
    stats: { trips: 0, taps: 0, earned: 0 },
    lastSeen: Date.now(),
  };
}

// ---------- derived values ----------

export function capacity(c, s) {
  let cap = c.baseCapacity;
  for (const u of c.upgrades) if (s.upgrades[u.id] && u.capacity) cap = Math.max(cap, u.capacity);
  return cap;
}
export function speed(c, s) {
  let v = c.walkSpeed;
  for (const u of c.upgrades) if (s.upgrades[u.id] && u.speed) v *= u.speed;
  return v;
}
export function carried(s) { return Object.values(s.inv).reduce((a, b) => a + b, 0); }

function mult(s, b, g) {
  s.priceMult[b] ??= {};
  return (s.priceMult[b][g] ??= { buy: 1, sell: 1 });
}
// What the building charges you for one unit.
export function buyPrice(c, s, b, g) {
  const base = c.buildings[b].sells[g];
  if (base == null) return null;
  return Math.max(1, Math.round(base * (c.prices.mode === 'reactive' ? (s.priceMult[b]?.[g]?.buy ?? 1) : 1)));
}
// What the building pays you for one unit.
export function sellPrice(c, s, b, g) {
  const base = c.buildings[b].buys[g];
  if (base == null) return null;
  return Math.max(1, Math.round(base * (c.prices.mode === 'reactive' ? (s.priceMult[b]?.[g]?.sell ?? 1) : 1)));
}

// ---------- planning ----------

export function canPlan(s) { return !s.trip; }

export function planAdd(c, s, b) {
  if (s.trip || !c.buildings[b]) return false;
  const last = s.plan.length ? s.plan[s.plan.length - 1].b : s.at;
  if (last === b) return false;
  const orders = {};
  if (c.stopMode !== 'manual') for (const g in c.buildings[b].buys) orders[g] = 'sell'; // default: sell what this place buys
  s.plan.push({ b, orders });
  return true;
}
export function planRemove(s, i) { if (!s.trip) s.plan.splice(i, 1); fixPlan(s); }
export function planClear(s) { if (!s.trip) s.plan = []; }
// Remove stops that repeat the one before them (can happen after removing a stop).
function fixPlan(s) {
  s.plan = s.plan.filter((st, i, a) => st.b !== (i ? a[i - 1].b : s.at));
}
export function toggleOrder(c, s, i, g) {
  const st = s.plan[i]; if (!st || s.trip) return;
  const bd = c.buildings[st.b];
  const kind = bd.sells[g] != null ? 'buy' : bd.buys[g] != null ? 'sell' : null;
  if (!kind) return;
  if (st.orders[g]) delete st.orders[g]; else st.orders[g] = kind;
}

// ---------- the trip ----------
// A trip walks the plan in order. At each stop the merchant stays at least one day (c.dayLength
// seconds). Stops with standing orders trade at the end of the day and walk on; trading by hand
// during the day suspends the orders for that visit, and then the merchant waits for "Walk on".

export function startTrip(s) {
  if (s.trip || !s.plan.length) return false;
  s.trip = { idx: 0, from: s.at, leg: 0, atStop: false, stay: 0, manual: false, go: false, startCoins: s.coins };
  s.at = null;
  return true;
}

function legEnds(c, s) {
  const tr = s.trip;
  const from = tr.idx === 0 ? c.buildings[tr.from] : c.buildings[s.plan[tr.idx - 1].b];
  const to = c.buildings[s.plan[tr.idx].b];
  return { from, to, len: Math.hypot(to.x - from.x, to.y - from.y) };
}

// Waiting at a stop for the player after the day is over.
export function isWaiting(s) {
  const tr = s.trip;
  return !!tr && tr.atStop && tr.manual && !tr.go && tr.stay <= 0;
}

export function hurry(c, s) {
  if (!s.trip || s.trip.atStop) return false;
  s.stats.taps++;
  s.trip.leg += c.hurryDistance;
  return true;
}

export function tick(c, s, dt) {
  const ev = [];
  recoverPrices(c, s, dt);
  let budget = dt;
  let guard = 0;
  while (s.trip && budget > 0 && guard++ < 50) {
    const tr = s.trip;
    if (tr.atStop) {
      if (tr.stay > 0) {
        const used = Math.min(tr.stay, budget);
        tr.stay -= used; budget -= used;
        if (tr.stay > 0) break;
      }
      if (tr.manual && !tr.go) break; // waiting for the player
      if (!tr.manual) runOrders(c, s, s.plan[tr.idx], ev);
      advance(c, s, ev);
      continue;
    }
    const { from, to, len } = legEnds(c, s);
    tr.leg += speed(c, s) * budget; budget = 0;
    if (tr.leg >= len) {
      const extra = (tr.leg - len) / speed(c, s);
      s.pos = { x: to.x, y: to.y };
      arrive(c, s, ev);
      budget = extra;
    } else {
      const f = tr.leg / len;
      s.pos = { x: from.x + (to.x - from.x) * f, y: from.y + (to.y - from.y) * f };
    }
  }
  return ev;
}

function arrive(c, s, ev) {
  const st = s.plan[s.trip.idx], auto = autoTrades(c, s, st);
  // While the app is closed, stops without orders are walked past.
  if (s._offline && !auto) { advance(c, s, ev); return; }
  ev.push({ type: 'arrive', b: st.b, auto });
  Object.assign(s.trip, { atStop: true, stay: c.dayLength, manual: !auto, go: false });
}

function runOrders(c, s, st, ev) {
  // Sell first, so the coins can pay for buying.
  for (const g in st.orders) if (st.orders[g] === 'sell') {
    let n = 0, got = 0;
    while ((s.inv[g] || 0) > 0) {
      const p = sellPrice(c, s, st.b, g);
      s.inv[g]--; s.coins += p; got += p; n++;
      s.stats.earned += p;
      if (c.prices.mode === 'reactive') mult(s, st.b, g).sell *= c.prices.sellDrop;
    }
    if (!s.inv[g]) delete s.inv[g];
    if (n) ev.push({ type: 'sell', b: st.b, good: g, n, coins: got });
  }
  // Buy round-robin across the goods ordered here until full or broke.
  const buys = Object.keys(st.orders).filter(g => st.orders[g] === 'buy');
  const bought = {};
  let progress = true;
  while (buys.length && progress) {
    progress = false;
    for (const g of buys) {
      if (carried(s) >= capacity(c, s)) break;
      const p = buyPrice(c, s, st.b, g);
      if (s.coins < p) continue;
      s.coins -= p; s.inv[g] = (s.inv[g] || 0) + 1;
      (bought[g] ??= { n: 0, coins: 0 }); bought[g].n++; bought[g].coins += p;
      if (c.prices.mode === 'reactive') mult(s, st.b, g).buy *= c.prices.buyRise;
      progress = true;
    }
  }
  for (const g in bought) ev.push({ type: 'buy', b: st.b, good: g, n: bought[g].n, coins: bought[g].coins });
}

function advance(c, s, ev) {
  const tr = s.trip;
  tr.idx++; tr.leg = 0; tr.atStop = false; tr.stay = 0; tr.manual = false; tr.go = false;
  const stopping = tr.stopRequested;
  if (tr.idx >= s.plan.length || stopping) {
    s.at = s.plan[tr.idx - 1].b;
    s.stats.trips++;
    const profit = s.coins - tr.startCoins;
    s.trip = null;
    ev.push({ type: 'done', profit });
    if (profit > 0) unlockAch(s, 'firstProfit', ev);
    if (c.routeMode === 'loop' && !stopping) startTrip(s);
  }
}

// Estimated seconds for one lap of the loop (walking at full speed, one day per stop).
export function loopSeconds(c, s) {
  if (!s.plan.length) return 0;
  let d = 0;
  for (let i = 0; i < s.plan.length; i++) {
    const a = c.buildings[s.plan[(i - 1 + s.plan.length) % s.plan.length].b], b = c.buildings[s.plan[i].b];
    d += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return d / speed(c, s) + s.plan.length * c.dayLength;
}

function recoverPrices(c, s, dt) {
  if (c.prices.mode !== 'reactive') return;
  const k = 1 - Math.exp(-dt / c.prices.recoverSeconds);
  for (const b in s.priceMult) for (const g in s.priceMult[b]) {
    const m = s.priceMult[b][g];
    m.buy += (1 - m.buy) * k; m.sell += (1 - m.sell) * k;
  }
}

// ---------- upgrades ----------

export function upgradeAvailable(c, s, u) { return !s.upgrades[u.id]; }

export function buyUpgrade(c, s, id) {
  const u = c.upgrades.find(x => x.id === id);
  if (!u || s.upgrades[id] || s.coins < u.cost) return null;
  s.coins -= u.cost;
  s.upgrades[id] = true;
  const ev = [{ type: 'upgrade', id }];
  if (id === 'horse' && !s.upgrades.cart) unlockAch(s, 'horseBeforeCart', ev);
  return ev;
}

function unlockAch(s, id, ev) {
  if (s.achievements[id]) return;
  s.achievements[id] = Date.now();
  ev.push({ type: 'achievement', id });
}

// Whether standing orders are available (always in 'orders' mode, or after the upgrade).
export function ordersUnlocked(c, s) {
  return c.stopMode !== 'manual' || c.upgrades.some(u => u.orders && s.upgrades[u.id]);
}
// A stop trades by itself when orders are unlocked and it has at least one order.
export function autoTrades(c, s, st) {
  return c.stopMode !== 'manual' || (ordersUnlocked(c, s) && Object.keys(st.orders).length > 0);
}

// ---------- trading by hand ----------

// The building the merchant can trade with right now, or null while walking.
export function tradingAt(s) {
  if (!s.trip) return s.at;
  if (s.trip.atStop) return s.plan[s.trip.idx].b;
  return null;
}

export function maxBuy(c, s, g) {
  const b = tradingAt(s); if (!b) return 0;
  const p = buyPrice(c, s, b, g); if (p == null) return 0;
  return Math.max(0, Math.min(Math.floor(s.coins / p), capacity(c, s) - carried(s)));
}

// Trading by hand during a visit takes over from the standing orders for that visit.
function takeOver(s) { if (s.trip?.atStop) s.trip.manual = true; }

export function tradeBuy(c, s, g, n = 1) {
  const b = tradingAt(s);
  n = Math.min(n, maxBuy(c, s, g));
  if (!b || n <= 0) return null;
  takeOver(s);
  const p = buyPrice(c, s, b, g);
  s.coins -= p * n; s.inv[g] = (s.inv[g] || 0) + n;
  return { type: 'buy', b, good: g, n, coins: p * n };
}

export function tradeSell(c, s, g, n = 1) {
  const b = tradingAt(s);
  const p = b && sellPrice(c, s, b, g);
  n = Math.min(n, s.inv[g] || 0);
  if (!p || n <= 0) return null;
  takeOver(s);
  s.inv[g] -= n; if (!s.inv[g]) delete s.inv[g];
  s.coins += p * n; s.stats.earned += p * n;
  return { type: 'sell', b, good: g, n, coins: p * n };
}

// "Walk on": leave once the day is over (right away if it already is).
export function continueTrip(c, s) {
  if (!s.trip?.atStop || !s.trip.manual) return false;
  s.trip.go = true;
  return true;
}

// Ask the merchant to stop. At a stop they stop right there; walking, at the next building.
export function requestStop(s) {
  const tr = s.trip;
  if (!tr) return false;
  if (tr.atStop) { s.at = s.plan[tr.idx].b; s.trip = null; s.stats.trips++; return true; }
  tr.stopRequested = true;
  return true;
}

// Time away: a looping merchant keeps walking. Returns coins gained.
export function applyOffline(c, s, seconds) {
  const secs = Math.min(seconds, (c.offlineCapHours || 8) * 3600);
  const before = s.coins;
  const step = 0.5;
  let t = 0;
  // Only a route with at least one stop that trades by itself does anything while closed.
  if (s.trip && s.plan.some(st => autoTrades(c, s, st))) {
    s._offline = true;
    // A visit the player had taken over: the merchant leaves as soon as the day is done.
    if (s.trip.atStop && s.trip.manual) s.trip.go = true;
    try {
      while (t < secs && s.trip) {
        const dt = Math.min(step, secs - t);
        tick(c, s, dt); t += dt;
      }
    } finally { delete s._offline; }
  }
  recoverPrices(c, s, Math.max(0, secs - t));
  return s.coins - before;
}

// ---------- saves ----------

export function serialize(s) { return JSON.stringify(s); }

export function deserialize(c, json) {
  const d = JSON.parse(json);
  if (!d || typeof d.coins !== 'number' || !d.pos) throw new Error('Not a Trade Inc town save');
  const f = createState(c);
  const s = { ...f, ...d, stats: { ...f.stats, ...(d.stats || {}) } };
  s.plan = (s.plan || []).filter(st => c.buildings[st.b]);
  if (s.trip && (s.trip.idx >= s.plan.length)) { s.trip = null; s.at = s.plan.at(-1)?.b ?? c.startAt; }
  if (!s.trip && !c.buildings[s.at]) s.at = c.startAt;
  s.saveVersion = SAVE_VERSION;
  return s;
}

// ---------- formatting ----------

const SUFFIXES = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];
export function formatNumber(n) {
  if (!isFinite(n)) return '∞';
  if (n < 1000) return Math.floor(n).toString();
  const tier = Math.floor(Math.log10(n) / 3);
  if (tier >= SUFFIXES.length) return n.toExponential(2).replace('+', '');
  const v = n / Math.pow(1000, tier);
  return (v < 10 ? v.toFixed(2) : v < 100 ? v.toFixed(1) : Math.floor(v).toString()) + SUFFIXES[tier];
}
