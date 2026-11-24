// Pure game logic. No DOM, no timers, no storage: the UI calls these functions.
// Keeping this file self-contained makes a later port (e.g. Godot) a straight translation.

export const SAVE_VERSION = 1;

export function createState(content) {
  const routes = {};
  for (const r of content.routes) {
    routes[r.id] = { unlocked: r.unlockCost === 0, caravans: 0, progress: 0, running: false };
  }
  return {
    saveVersion: SAVE_VERSION,
    coins: 0,
    routes,
    stats: { totalEarned: 0, taps: 0, trips: 0, startedAt: Date.now() },
    lastSeen: Date.now(),
  };
}

export function routeDef(content, id) {
  return content.routes.find(r => r.id === id);
}

export function milestonesReached(content, caravans) {
  return content.milestones.filter(m => caravans >= m).length;
}

export function nextMilestone(content, caravans) {
  return content.milestones.find(m => caravans < m) ?? null;
}

export function tripTime(content, def, rs) {
  return def.tripSeconds / Math.pow(content.milestoneSpeedMult, milestonesReached(content, rs.caravans));
}

export function payoutPerTrip(def, rs) {
  return def.payout * Math.max(1, rs.caravans);
}

export function incomePerSecond(content, state) {
  let total = 0;
  for (const def of content.routes) {
    const rs = state.routes[def.id];
    if (rs.unlocked && rs.caravans > 0) total += payoutPerTrip(def, rs) / tripTime(content, def, rs);
  }
  return total;
}

// Cost of buying n caravans when `owned` are already owned (geometric series).
export function caravanCost(def, owned, n = 1) {
  const g = def.costGrowth;
  const first = def.caravanCost * Math.pow(g, owned);
  return first * (Math.pow(g, n) - 1) / (g - 1);
}

export function maxAffordable(def, owned, coins) {
  const g = def.costGrowth;
  const first = def.caravanCost * Math.pow(g, owned);
  if (coins < first) return 0;
  return Math.floor(Math.log(coins * (g - 1) / first + 1) / Math.log(g));
}

function earn(state, amount) {
  state.coins += amount;
  state.stats.totalEarned += amount;
}

// Advance time. Returns arrival events so the UI can celebrate them.
export function tick(content, state, dt) {
  const events = [];
  for (const def of content.routes) {
    const rs = state.routes[def.id];
    if (!rs.unlocked || !rs.running) continue;
    const T = tripTime(content, def, rs);
    rs.progress += dt / T;
    if (rs.progress >= 1) {
      let trips = Math.floor(rs.progress);
      if (rs.caravans === 0) { trips = 1; rs.progress = 0; rs.running = false; }
      else rs.progress -= trips;
      const amount = trips * payoutPerTrip(def, rs);
      earn(state, amount);
      state.stats.trips += trips;
      events.push({ type: 'arrive', routeId: def.id, amount, trips });
    }
  }
  return events;
}

// A tap on a route: starts an idle route, or pushes a running caravan forward.
export function tap(content, state, id) {
  const rs = state.routes[id];
  if (!rs || !rs.unlocked) return null;
  state.stats.taps++;
  if (!rs.running) { rs.running = true; rs.progress = Math.max(rs.progress, content.tapBoost); return 'started'; }
  rs.progress += content.tapBoost;
  return 'boosted';
}

export function hire(content, state, id, n = 1) {
  const def = routeDef(content, id), rs = state.routes[id];
  if (!rs.unlocked || n <= 0) return false;
  const cost = caravanCost(def, rs.caravans, n);
  if (state.coins < cost) return false;
  state.coins -= cost;
  rs.caravans += n;
  rs.running = true;
  return true;
}

export function unlock(content, state, id) {
  const def = routeDef(content, id), rs = state.routes[id];
  if (rs.unlocked || state.coins < def.unlockCost) return false;
  state.coins -= def.unlockCost;
  rs.unlocked = true;
  return true;
}

// Earnings while the game was closed. Only hired caravans work offline.
export function applyOffline(content, state, seconds) {
  const capped = Math.min(seconds, content.offlineCapHours * 3600);
  if (capped <= 0) return 0;
  let total = 0;
  for (const def of content.routes) {
    const rs = state.routes[def.id];
    if (!rs.unlocked || rs.caravans === 0) continue;
    const T = tripTime(content, def, rs);
    const p = rs.progress + capped / T;
    const trips = Math.floor(p);
    rs.progress = p - trips;
    total += trips * payoutPerTrip(def, rs);
    state.stats.trips += trips;
  }
  earn(state, total);
  return total;
}

export function serialize(state) {
  return JSON.stringify(state);
}

// Accepts a save string; fills in anything missing so old saves keep working when content grows.
export function deserialize(content, json) {
  const data = JSON.parse(json);
  if (typeof data !== 'object' || data === null || typeof data.coins !== 'number') throw new Error('Not a Trade Inc save');
  const fresh = createState(content);
  const state = { ...fresh, ...data, stats: { ...fresh.stats, ...(data.stats || {}) }, routes: {} };
  for (const def of content.routes) state.routes[def.id] = { ...fresh.routes[def.id], ...((data.routes || {})[def.id] || {}) };
  state.saveVersion = SAVE_VERSION;
  return state;
}

const SUFFIXES = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];
export function formatNumber(n) {
  if (!isFinite(n)) return '∞';
  if (n < 1000) return n < 10 && n % 1 ? n.toFixed(1) : Math.floor(n).toString();
  const tier = Math.floor(Math.log10(n) / 3);
  if (tier >= SUFFIXES.length) return n.toExponential(2).replace('+', '');
  const v = n / Math.pow(1000, tier);
  return (v < 10 ? v.toFixed(2) : v < 100 ? v.toFixed(1) : Math.floor(v).toString()) + SUFFIXES[tier];
}

export function formatTime(s) {
  if (s < 1) return s.toFixed(2) + 's';
  if (s < 60) return s.toFixed(1) + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm ' + Math.floor(s % 60) + 's';
  return Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm';
}
