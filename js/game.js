// Pure game logic: one merchant, towns made of buildings, and a land map of towns.
// No DOM, timers or storage. The UI calls these and reacts to the returned events.
//
// There are two route "levels" that share the same rules:
//   'town' — walking between the buildings of the town the merchant is in (a route per town)
//   'land' — riding between towns (needs the horse); each town trades as one combined market
// At each stop the merchant stays at least one day. Standing orders run at the end of the day;
// trading by hand during the day takes over that visit and the merchant waits for "Walk on".

export const SAVE_VERSION = 2;

// ---------- setup ----------

function newRoute(at, node) {
  return { at, pos: { x: node.x, y: node.y }, plan: [], trip: null };
}

export function createState(c) {
  const home = c.towns[c.startTown];
  return {
    saveVersion: SAVE_VERSION,
    coins: c.startCoins,
    inv: {},
    upgrades: {},
    achievements: {},
    stats: { trips: 0, taps: 0, earned: 0 },
    town: c.startTown,                 // town the merchant is in (null while riding between towns)
    locals: { [c.startTown]: newRoute(c.startAt, home.buildings[c.startAt]) },
    land: newRoute(c.startTown, home),
    visited: { [c.startTown]: true },
    view: 'town',
    hires: [],                         // hired merchants: { id, name, route, inv }
    stock: {},                         // land trade pressure: stock[town][good], below 0 = bought out
    lastSeen: Date.now(),
  };
}

// ---------- derived values ----------

export function capacity(c, s) {
  let cap = c.baseCapacity;
  for (const u of c.upgrades) if (s.upgrades[u.id] && u.capacity) cap = Math.max(cap, u.capacity);
  return cap;
}
function walkSpeed(c, s) {
  let v = c.walkSpeed;
  for (const u of c.upgrades) if (s.upgrades[u.id] && u.speed) v *= u.speed;
  return v;
}
function rideSpeed(c, s) {
  let v = c.rideSpeed;
  for (const u of c.upgrades) if (s.upgrades[u.id] && u.rideSpeed) v *= u.rideSpeed;
  return v;
}
export function carried(s) { return Object.values(s.inv).reduce((a, b) => a + b, 0); }
export function landUnlocked(c, s) { return c.upgrades.some(u => u.unlocksLand && s.upgrades[u.id]); }

// The town whose buildings the town level refers to.
export function currentTown(s) { return s.town ?? s.land.at; }

// Levels: 'town', 'land' (you), or 'hire:<id>' (a hired merchant's land route).
export const isHire = level => typeof level === 'string' && level.startsWith('hire:');
const landLike = level => level === 'land' || isHire(level);
export function hireOf(s, level) { return s.hires.find(h => 'hire:' + h.id === level); }
function invOf(s, level) { return isHire(level) ? hireOf(s, level).inv : s.inv; }
function capFor(c, s, level) { return isHire(level) ? c.hiring.capacity : capacity(c, s); }

export function route(s, level) {
  if (level === 'land') return s.land;
  if (isHire(level)) return hireOf(s, level)?.route;
  const t = currentTown(s);
  return s.locals[t];
}
function ensureLocal(c, s, townId) {
  if (!s.locals[townId]) {
    const t = c.towns[townId], first = Object.keys(t.buildings)[0];
    s.locals[townId] = newRoute(first, t.buildings[first]);
  }
  return s.locals[townId];
}

function nodes(c, s, level) {
  return landLike(level) ? c.towns : c.towns[currentTown(s)].buildings;
}
function speedFor(c, s, level) { return isHire(level) ? c.rideSpeed : level === 'land' ? rideSpeed(c, s) : walkSpeed(c, s); }
function hurryFor(c, level) { return level === 'land' ? c.landHurry : c.hurryDistance; }

// What a stop buys and sells. A town on the land level trades as one market:
// the cheapest seller and the best buyer among its buildings.
// With a state passed in, land prices include trade pressure (see priceMult).
export function market(c, level, id, s) {
  if (!landLike(level)) { const b = findBuilding(c, id); return { sells: b.sells, buys: b.buys }; }
  const sells = {}, buys = {};
  for (const b of Object.values(c.towns[id].buildings)) {
    for (const g in b.sells) sells[g] = Math.min(sells[g] ?? Infinity, b.sells[g]);
    for (const g in b.buys) buys[g] = Math.max(buys[g] ?? 0, b.buys[g]);
  }
  if (s) {
    for (const g in sells) sells[g] = adjust(sells[g], priceMult(c, s, id, g));
    for (const g in buys) buys[g] = adjust(buys[g], priceMult(c, s, id, g));
  }
  return { sells, buys };
}
const adjust = (p, m) => Math.max(1, Math.round(p * m));

// Land prices react to trading: every unit bought from a town makes that good
// scarcer there (dearer to buy, better to sell), every unit sold makes it more
// plentiful (cheaper both ways). The effect fades back to normal over time.
export function priceMult(c, s, town, g) {
  const r = c.prices.react; if (!r || !s?.stock) return 1;
  const k = s.stock[town]?.[g] || 0;
  return Math.min(r.maxMult, Math.max(r.minMult, 1 - r.perUnit * k));
}
function shift(c, s, level, town, g, n) {
  if (!landLike(level) || !c.prices.react) return;
  const t = (s.stock ??= {})[town] ??= {};
  t[g] = (t[g] || 0) + n;
}
function recover(c, s, dt) {
  const r = c.prices.react; if (!r || !s.stock) return;
  const f = Math.exp(-dt / r.recoverSeconds);
  for (const t in s.stock) {
    for (const g in s.stock[t]) { s.stock[t][g] *= f; if (Math.abs(s.stock[t][g]) < 0.05) delete s.stock[t][g]; }
    if (!Object.keys(s.stock[t]).length) delete s.stock[t];
  }
}
function findBuilding(c, id) {
  for (const t of Object.values(c.towns)) if (t.buildings[id]) return t.buildings[id];
  return null;
}

// What the stop charges you for one unit / pays you for one unit. Prices are fixed.
export function buyPrice(c, level, id, g, s) { return market(c, level, id, s).sells[g] ?? null; }
export function sellPrice(c, level, id, g, s) { return market(c, level, id, s).buys[g] ?? null; }

// Price shown on the land map: exact once visited, a range before that.
export function priceEstimate(c, s, townId, g, kind) {
  const p = kind === 'buy' ? buyPrice(c, 'land', townId, g, s) : sellPrice(c, 'land', townId, g, s);
  if (p == null) return null;
  const mode = c.prices.estimate || 'exact';
  const exact = mode === 'exact' || (mode === 'untilVisited' && s.visited[townId]) || (mode === 'onlyHere' && s.town === townId);
  if (exact) return { lo: p, hi: p, exact: true };
  const h = hash(townId + g + kind), spread = c.prices.estimateSpread;
  const mid = p * (1 + (h - 0.5) * spread);
  return { lo: Math.max(1, Math.min(p, Math.floor(mid * (1 - spread)))), hi: Math.max(p, Math.ceil(mid * (1 + spread))), exact: false };
}
function hash(str) { let h = 2166136261; for (const ch of str) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return ((h >>> 0) % 10000) / 10000; }

// ---------- planning ----------

// Whether a route on this level can be planned right now.
export function canPlan(c, s, level) {
  if (level === 'land') return landUnlocked(c, s) && !s.land.trip;
  if (isHire(level)) return !!route(s, level) && !route(s, level).trip;
  return !s.land.trip && s.town != null && !route(s, 'town').trip;
}

export function planAdd(c, s, level, id) {
  if (!canPlan(c, s, level) || !nodes(c, s, level)[id]) return false;
  const r = route(s, level);
  const last = r.plan.length ? r.plan[r.plan.length - 1].b : r.at;
  if (last === id) return false;
  if (isHire(level) && r.plan.length >= management(c, s).stops) return false;
  const orders = {};
  if (c.stopMode !== 'manual') for (const g in market(c, level, id).buys) orders[g] = 'sell';
  r.plan.push({ b: id, orders });
  return true;
}
export function planRemove(c, s, level, i) {
  if (!canPlan(c, s, level)) return;
  const r = route(s, level);
  r.plan.splice(i, 1);
  r.plan = r.plan.filter((st, k, a) => st.b !== (k ? a[k - 1].b : r.at));
}
export function planClear(c, s, level) { if (canPlan(c, s, level)) route(s, level).plan = []; }

export function toggleOrder(c, s, level, i, g) {
  const r = route(s, level), st = r.plan[i];
  if (!st || r.trip) return;
  const m = market(c, level, st.b);
  const kind = m.sells[g] != null ? 'buy' : m.buys[g] != null ? 'sell' : null;
  if (!kind) return;
  if (st.orders[g]) delete st.orders[g]; else st.orders[g] = kind;
}

// Standing orders are available after the upgrade (or always, in 'orders' stop mode).
export function ordersUnlocked(c, s) {
  return c.stopMode !== 'manual' || c.upgrades.some(u => u.orders && s.upgrades[u.id]);
}
export function autoTrades(c, s, st, level) {
  if (isHire(level)) return true;
  return c.stopMode !== 'manual' || (ordersUnlocked(c, s) && Object.keys(st.orders).length > 0);
}

// ---------- trips ----------

export function activeLevel(s) {
  if (s.land.trip) return 'land';
  if (s.town && s.locals[s.town]?.trip) return 'town';
  return null;
}

export function startTrip(c, s, level) {
  const r = route(s, level);
  if (!r || r.trip || !r.plan.length) return false;
  if (level === 'land') {
    if (!landUnlocked(c, s)) return false;
    // The merchant leaves town: any walk around town ends.
    const loc = s.town && s.locals[s.town];
    if (loc?.trip) endTrip(c, s, 'town', loc.trip.atStop ? loc.plan[loc.trip.idx].b : loc.at);
    if (s.town) r.at = s.town;
  } else if (level === 'town' && s.land.trip) return false;
  r.trip = { idx: 0, from: r.at, leg: 0, atStop: false, stay: 0, manual: false, go: false, startCoins: s.coins };
  r.at = null;
  if (level === 'land') s.town = null;
  return true;
}

// Walk straight to one building in town, no loop. The planned route is kept
// aside and comes back on arrival.
export function goTo(c, s, id) {
  const r = route(s, 'town');
  if (!canPlan(c, s, 'town') || s.land.trip || r.at === id || !nodes(c, s, 'town')[id]) return false;
  r.saved = r.plan; r.plan = [{ b: id, orders: {} }];
  if (!startTrip(c, s, 'town')) { r.plan = r.saved; delete r.saved; return false; }
  r.trip.once = true;
  return true;
}

function legEnds(c, s, level) {
  const r = route(s, level), tr = r.trip, N = nodes(c, s, level);
  const from = tr.idx === 0 ? N[tr.from] : N[r.plan[tr.idx - 1].b];
  const to = N[r.plan[tr.idx].b];
  return { from, to, len: Math.hypot(to.x - from.x, to.y - from.y) };
}

export function isWaiting(s) {
  const L = activeLevel(s); if (!L) return false;
  const tr = route(s, L).trip;
  return tr.atStop && tr.manual && !tr.go && tr.stay <= 0;
}

export function hurry(c, s) {
  const L = activeLevel(s); if (!L) return false;
  const tr = route(s, L).trip;
  if (tr.atStop) return false;
  s.stats.taps++;
  tr.leg += hurryFor(c, L);
  return true;
}

export function tick(c, s, dt) {
  const ev = [];
  recover(c, s, dt);
  const L = activeLevel(s);
  if (L) tickRoute(c, s, L, dt, ev);
  for (const h of s.hires) if (h.route.trip) tickRoute(c, s, 'hire:' + h.id, dt, ev);
  return ev;
}

function tickRoute(c, s, level, dt, ev) {
  let budget = dt, guard = 0;
  while (budget > 0 && guard++ < 50) {
    const r = route(s, level), tr = r?.trip;
    if (!tr) break;
    if (tr.atStop) {
      if (tr.stay > 0) {
        const used = Math.min(tr.stay, budget);
        tr.stay -= used; budget -= used;
        if (tr.stay > 0) break;
      }
      if (tr.manual && !tr.go) break; // waiting for the player
      if (!tr.manual) {
        const st = r.plan[tr.idx];
        if (st.program?.length && isHire(level)) { if (runProgram(c, s, level, st, ev)) continue; }
        else runOrders(c, s, level, st, ev);
      }
      advance(c, s, level, ev);
      continue;
    }
    const sp = speedFor(c, s, level);
    const { from, to, len } = legEnds(c, s, level);
    tr.leg += sp * budget; budget = 0;
    if (tr.leg >= len) {
      budget = (tr.leg - len) / sp;
      r.pos = { x: to.x, y: to.y };
      arrive(c, s, level, ev);
    } else {
      const f = tr.leg / len;
      r.pos = { x: from.x + (to.x - from.x) * f, y: from.y + (to.y - from.y) * f };
    }
  }
}

function arrive(c, s, level, ev) {
  const r = route(s, level), st = r.plan[r.trip.idx], auto = autoTrades(c, s, st, level);
  if (r.trip.once) { ev.push({ type: 'arrive', level, b: st.b, auto: false }); endTrip(c, s, level, st.b); return; }
  if (isHire(level)) {
    s.visited[st.b] = true;
    ev.push({ type: 'arrive', level, b: st.b, auto: true });
    Object.assign(r.trip, { atStop: true, stay: c.dayLength, manual: false, go: false });
    return;
  }
  if (level === 'land') {
    s.town = st.b;
    ensureLocal(c, s, st.b);
    if (!s.visited[st.b]) { s.visited[st.b] = true; if (st.b !== c.startTown) unlockAch(s, 'firstTown', ev); }
  }
  // While the app is closed, stops without orders are passed by.
  if (s._offline && !auto) { advance(c, s, level, ev); return; }
  ev.push({ type: 'arrive', level, b: st.b, auto });
  // Before standing orders there is no minimum stay: trade, then walk on.
  Object.assign(r.trip, { atStop: true, stay: ordersUnlocked(c, s) ? c.dayLength : 0, manual: !auto, go: false });
}

function runOrders(c, s, level, st, ev) {
  const inv = invOf(s, level), cap = capFor(c, s, level);
  for (const g in st.orders) if (st.orders[g] === 'sell') {
    const n = inv[g] || 0;
    if (!sellPrice(c, level, st.b, g) || !n) continue;
    const got = sellUnits(c, s, level, st.b, g, n);
    delete inv[g]; s.coins += got; s.stats.earned += got;
    ev.push({ type: 'sell', level, b: st.b, good: g, n, coins: got });
  }
  const buys = Object.keys(st.orders).filter(g => st.orders[g] === 'buy');
  const bought = {};
  let progress = true;
  while (buys.length && progress) {
    progress = false;
    for (const g of buys) {
      if (Object.values(inv).reduce((a, b) => a + b, 0) >= cap) break;
      const p = buyPrice(c, level, st.b, g, s);
      if (p == null || s.coins < p) continue;
      s.coins -= p; inv[g] = (inv[g] || 0) + 1; shift(c, s, level, st.b, g, -1);
      (bought[g] ??= { n: 0, coins: 0 }); bought[g].n++; bought[g].coins += p;
      progress = true;
    }
  }
  for (const g in bought) ev.push({ type: 'buy', level, b: st.b, good: g, n: bought[g].n, coins: bought[g].coins });
}

function advance(c, s, level, ev) {
  const r = route(s, level), tr = r.trip;
  tr.idx++; tr.leg = 0; tr.atStop = false; tr.stay = 0; tr.manual = false; tr.go = false;
  tr.pc = 0; tr.earned = 0; tr.spent = 0; tr.snap = null;
  if (tr.idx >= r.plan.length || tr.stopRequested) {
    const stopping = tr.stopRequested;
    const profit = s.coins - tr.startCoins;
    endTrip(c, s, level, r.plan[tr.idx - 1].b);
    ev.push({ type: 'done', level, profit });
    if (profit > 0 && !isHire(level)) unlockAch(s, 'firstProfit', ev);
    if (c.routeMode === 'loop' && !stopping) startTrip(c, s, level);
  } else if (level === 'land') s.town = null; // back on the road
}

function endTrip(c, s, level, at) {
  const r = route(s, level);
  const once = r.trip?.once;
  r.trip = null; r.at = at;
  if (r.saved) { r.plan = r.saved; delete r.saved; }
  if (!isHire(level) && !once) s.stats.trips++;
  if (level === 'land') { s.town = at; ensureLocal(c, s, at); }
}

// Seconds for one lap of the loop at normal speed, one day per stop.
export function loopSeconds(c, s, level) {
  const r = route(s, level);
  if (!r?.plan.length) return 0;
  const N = nodes(c, s, level);
  let d = 0;
  for (let i = 0; i < r.plan.length; i++) {
    const a = N[r.plan[(i - 1 + r.plan.length) % r.plan.length].b], b = N[r.plan[i].b];
    d += Math.hypot(b.x - a.x, b.y - a.y);
  }
  const waits = r.plan.reduce((a, st) => a + (st.program || []).filter(b => b.op === 'wait').reduce((x, b) => x + (b.days || 1), 0), 0);
  return d / speedFor(c, s, level) + (r.plan.length + waits) * c.dayLength;
}

// ---------- instruction blocks ----------
// A hired merchant's stop can carry a program instead of standing orders: a
// list of blocks run at the end of the day there. Blocks:
//   { op:'sell', good, amount:'all'|n }    { op:'buy', good, amount:'all'|n }
//   { op:'spend', good }                   buy good with what this visit's sales earned
//   { op:'wait', days }                    stay longer; the rest runs after (top level only)
//   { op:'if', good, side:'buy'|'sell', cmp:'<'|'>'|'dropped'|'rose', value, then:[...] }
// 'dropped'/'rose' compare with the price when the last Wait began.
export function programUnlocked(c, s) { return management(c, s).level >= c.blocks.sell; }
export function blockAllowed(c, s, op, cmp) {
  const lv = management(c, s).level;
  if (lv < (c.blocks[op] ?? 99)) return false;
  return !(op === 'if' && (cmp === 'dropped' || cmp === 'rose') && lv < c.blocks.cmpTrend);
}
// Replace stop i's program with a cleaned copy. Returns false if not allowed.
export function setProgram(c, s, level, i, program) {
  const r = route(s, level), st = r?.plan[i];
  if (!st || !isHire(level) || !canPlan(c, s, level)) return false;
  let count = 0;
  const clean = (list, depth) => (Array.isArray(list) ? list : []).flatMap(b => {
    if (!b || !c.goods[b.good] && b.op !== 'wait') return [];
    if (!blockAllowed(c, s, b.op, b.cmp) || ++count > c.blocks.maxBlocks) return [];
    const amt = a => a === 'all' ? 'all' : Math.max(1, Math.min(999, Math.floor(+a) || 1));
    switch (b.op) {
      case 'sell': case 'buy': return [{ op: b.op, good: b.good, amount: amt(b.amount) }];
      case 'spend': return [{ op: 'spend', good: b.good }];
      case 'wait': return depth ? [] : [{ op: 'wait', days: Math.max(1, Math.min(9, Math.floor(+b.days) || 1)) }];
      case 'if': {
        if (depth + 1 >= c.blocks.maxDepth + 1) return [];
        const cmp = ['<', '>', 'dropped', 'rose'].includes(b.cmp) ? b.cmp : '<';
        return [{ op: 'if', good: b.good, side: b.side === 'sell' ? 'sell' : 'buy', cmp, value: Math.max(0, Math.floor(+b.value) || 0), then: clean(b.then, depth + 1) }];
      }
    }
    return [];
  });
  st.program = clean(program, 0);
  return true;
}

function runProgram(c, s, level, st, ev) {
  const tr = route(s, level).trip, list = st.program;
  for (let i = tr.pc || 0; i < list.length; i++) {
    const b = list[i];
    if (b.op === 'wait') {
      tr.pc = i + 1; tr.stay = c.dayLength * (b.days || 1);
      tr.snap = market(c, level, st.b, s);
      ev.push({ type: 'wait', level, b: st.b, days: b.days || 1 });
      return true;
    }
    runBlock(c, s, level, st.b, b, tr, ev);
  }
  return false;
}
function runBlock(c, s, level, town, b, tr, ev) {
  const inv = invOf(s, level);
  if (b.op === 'sell') {
    const n = Math.min(inv[b.good] || 0, b.amount === 'all' ? Infinity : b.amount);
    if (!n || !sellPrice(c, level, town, b.good)) return;
    const got = sellUnits(c, s, level, town, b.good, n);
    inv[b.good] -= n; if (!inv[b.good]) delete inv[b.good];
    s.coins += got; s.stats.earned += got; tr.earned = (tr.earned || 0) + got;
    ev.push({ type: 'sell', level, b: town, good: b.good, n, coins: got });
  } else if (b.op === 'buy') {
    buyUnits(c, s, level, town, b.good, b.amount === 'all' ? Infinity : b.amount, Infinity, ev);
  } else if (b.op === 'spend') {
    tr.spent = (tr.spent || 0) + buyUnits(c, s, level, town, b.good, Infinity, (tr.earned || 0) - (tr.spent || 0), ev);
  } else if (b.op === 'if') {
    if (testBlock(c, s, level, town, b, tr)) for (const x of b.then) runBlock(c, s, level, town, x, tr, ev);
  }
}
export function testBlock(c, s, level, town, b, tr) {
  const now = market(c, level, town, s)[b.side === 'buy' ? 'sells' : 'buys'][b.good];
  if (now == null) return false;
  if (b.cmp === '<') return now < b.value;
  if (b.cmp === '>') return now > b.value;
  const was = tr?.snap?.[b.side === 'buy' ? 'sells' : 'buys'][b.good];
  if (was == null) return false;
  return b.cmp === 'dropped' ? now < was : now > was;
}
function buyUnits(c, s, level, town, g, max, budget, ev) {
  const inv = invOf(s, level), cap = capFor(c, s, level);
  let n = 0, paid = 0;
  while (n < max && Object.values(inv).reduce((a, x) => a + x, 0) < cap) {
    const p = buyPrice(c, level, town, g, s);
    if (p == null || p > s.coins || paid + p > budget) break;
    s.coins -= p; paid += p; n++; inv[g] = (inv[g] || 0) + 1; shift(c, s, level, town, g, -1);
  }
  if (n) ev.push({ type: 'buy', level, b: town, good: g, n, coins: paid });
  return paid;
}

// ---------- trading by hand ----------

// Where the merchant can trade right now: { level, id }, or null while on the move.
export function tradingAt(s) {
  if (s.land.trip) {
    const tr = s.land.trip;
    return tr.atStop ? { level: 'land', id: s.land.plan[tr.idx].b } : null;
  }
  const loc = s.town && s.locals[s.town];
  if (loc?.trip) return loc.trip.atStop ? { level: 'town', id: loc.plan[loc.trip.idx].b } : null;
  if (!s.town) return null;
  return s.view === 'land' ? { level: 'land', id: s.town } : { level: 'town', id: loc.at };
}

export function maxBuy(c, s, g) {
  const t = tradingAt(s); if (!t) return 0;
  if (buyPrice(c, t.level, t.id, g) == null) return 0;
  const room = capacity(c, s) - carried(s);
  let n = 0, coins = s.coins;
  const saved = s.stock?.[t.id]?.[g];
  while (n < room) {
    const p = buyPrice(c, t.level, t.id, g, s); if (coins < p) break;
    coins -= p; n++; shift(c, s, t.level, t.id, g, -1);
  }
  if (landLike(t.level)) { if (saved === undefined) delete s.stock[t.id]?.[g]; else s.stock[t.id][g] = saved; }
  return n;
}
// Sell n units one at a time (each lowers the next one's price on land). Returns coins.
function sellUnits(c, s, level, id, g, n) {
  let got = 0;
  for (let i = 0; i < n; i++) { got += sellPrice(c, level, id, g, s); shift(c, s, level, id, g, 1); }
  return got;
}

function takeOver(s) {
  const L = activeLevel(s); if (!L) return;
  const tr = route(s, L).trip;
  if (tr.atStop) tr.manual = true;
}

export function tradeBuy(c, s, g, n = 1) {
  const t = tradingAt(s);
  n = Math.min(n, maxBuy(c, s, g));
  if (!t || n <= 0) return null;
  takeOver(s);
  let paid = 0;
  for (let i = 0; i < n; i++) { paid += buyPrice(c, t.level, t.id, g, s); shift(c, s, t.level, t.id, g, -1); }
  s.coins -= paid; s.inv[g] = (s.inv[g] || 0) + n;
  return { type: 'buy', level: t.level, b: t.id, good: g, n, coins: paid };
}

export function tradeSell(c, s, g, n = 1) {
  const t = tradingAt(s);
  const p = t && sellPrice(c, t.level, t.id, g);
  n = Math.min(n, s.inv[g] || 0);
  if (!p || n <= 0) return null;
  takeOver(s);
  const got = sellUnits(c, s, t.level, t.id, g, n);
  s.inv[g] -= n; if (!s.inv[g]) delete s.inv[g];
  s.coins += got; s.stats.earned += got;
  return { type: 'sell', level: t.level, b: t.id, good: g, n, coins: got };
}

export function continueTrip(c, s) {
  const L = activeLevel(s); if (!L) return false;
  const tr = route(s, L).trip;
  if (!tr.atStop || !tr.manual) return false;
  tr.go = true;
  return true;
}

// Stop the active route: at a stop, right there; on the move, at the next stop.
export function requestStop(c, s) {
  const L = activeLevel(s); if (!L) return false;
  const r = route(s, L), tr = r.trip;
  if (tr.atStop) { endTrip(c, s, L, r.plan[tr.idx].b); return true; }
  tr.stopRequested = true;
  return true;
}

// ---------- time away ----------

export function applyOffline(c, s, seconds) {
  const secs = Math.min(seconds, (c.offlineCapHours || 8) * 3600);
  const before = s.coins;
  const L = activeLevel(s);
  const levels = s.hires.filter(h => h.route.trip).map(h => 'hire:' + h.id);
  if (L && route(s, L).plan.some(st => autoTrades(c, s, st, L))) {
    levels.push(L);
    const tr = route(s, L).trip;
    if (tr.atStop && tr.manual) tr.go = true; // a visit the player took over ends with the day
  }
  if (levels.length) {
    s._offline = true;
    try {
      for (let t = 0; t < secs; t += 0.5) {
        const dt = Math.min(0.5, secs - t);
        let any = false;
        recover(c, s, dt);
        for (const lv of levels) if (route(s, lv)?.trip) { tickRoute(c, s, lv, dt, []); any = true; }
        if (!any) { recover(c, s, secs - t - dt); break; }
      }
    } finally { delete s._offline; }
  } else recover(c, s, secs);
  return s.coins - before;
}

// ---------- hiring ----------

// Management skill: how many merchants you can employ and how many stops their routes may have.
export function management(c, s) {
  let m = { hires: 0, stops: 0, level: 0 };
  for (const u of c.upgrades) if (u.management && s.upgrades[u.id] && u.management.level > m.level) m = u.management;
  return m;
}

export function hireCost(c, s) {
  return Math.round(c.hiring.baseCost * Math.pow(c.hiring.costGrowth, s.hires.length));
}

export function canHire(c, s) {
  return s.hires.length < management(c, s).hires && s.coins >= hireCost(c, s);
}

// Hire a merchant who starts in the town you're in (or the last town you left).
export function hire(c, s) {
  if (!canHire(c, s)) return null;
  s.coins -= hireCost(c, s);
  const id = (s.hires.reduce((m, h) => Math.max(m, h.id), 0) || 0) + 1;
  const name = c.hiring.names[(id - 1) % c.hiring.names.length];
  const at = s.town ?? s.land.at;
  s.hires.push({ id, name, route: newRoute(at, c.towns[at]), inv: {} });
  const ev = [{ type: 'hired', id, name }];
  unlockAch(s, 'firstHire', ev);
  return ev;
}

export function hireStop(c, s, level) {
  const r = route(s, level);
  if (!r?.trip) return false;
  if (r.trip.atStop) { endTrip(c, s, level, r.plan[r.trip.idx].b); return true; }
  r.trip.stopRequested = true;
  return true;
}

// ---------- upgrades ----------

export function upgradeVisible(c, s, u) { return !u.needs || s.upgrades[u.needs]; }

export function buyUpgrade(c, s, id) {
  const u = c.upgrades.find(x => x.id === id);
  if (!u || s.upgrades[id] || s.coins < u.cost || !upgradeVisible(c, s, u)) return null;
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

// ---------- saves ----------

export function serialize(s) { return JSON.stringify(s); }

export function deserialize(c, json) {
  const d = JSON.parse(json);
  if (!d || typeof d.coins !== 'number') throw new Error('Not a Trade Inc save');
  const f = createState(c);
  if (!d.saveVersion || d.saveVersion < 2) {
    // Town-only save (0.3–0.6): its route becomes the home town's route.
    if (!d.pos) throw new Error('Not a Trade Inc save');
    const loc = { at: d.at, pos: d.pos, plan: d.plan || [], trip: d.trip || null };
    if (loc.trip) loc.trip = { atStop: false, stay: 0, manual: false, go: false, ...loc.trip };
    return {
      ...f, coins: d.coins, inv: d.inv || {}, upgrades: d.upgrades || {}, achievements: d.achievements || {},
      stats: { ...f.stats, ...(d.stats || {}) }, locals: { [c.startTown]: loc }, lastSeen: d.lastSeen || Date.now(),
    };
  }
  const s = { ...f, ...d, stats: { ...f.stats, ...(d.stats || {}) } };
  s.visited = { ...f.visited, ...(d.visited || {}) };
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
