import fs from 'node:fs';
import assert from 'node:assert/strict';
import * as G from '../js/game.js';
const c = JSON.parse(fs.readFileSync(new URL('../data/world.json', import.meta.url)));
const drift0 = c.prices.drift; c.prices.drift = { ...drift0, amp: 0 }; // exact prices for these tests
const runUntil = (s, cond, max = 120) => { const ev = []; for (let t = 0; t < max && !cond(); t += 0.05) ev.push(...G.tick(c, s, 0.05)); return ev; };

// --- town level, by hand ---
let s = G.createState(c);
assert.deepEqual(G.tradingAt(s), { level: 'town', id: 'market' });
assert.ok(G.planAdd(c, s, 'town', 'farm')); assert.ok(!G.planAdd(c, s, 'town', 'farm'));
G.planAdd(c, s, 'town', 'market');
assert.ok(!G.planAdd(c, s, 'land', 'highfold'), 'no land before horse');
G.startTrip(c, s, 'town');
runUntil(s, () => G.tradingAt(s));
assert.deepEqual(G.tradingAt(s), { level: 'town', id: 'farm' });
assert.equal(G.tradeBuy(c, s, 'apples', 99).n, 3);
runUntil(s, () => G.isWaiting(s));
G.continueTrip(c, s);
runUntil(s, () => G.tradingAt(s)?.id === 'market');
assert.equal(G.tradeSell(c, s, 'apples', 99).coins, 12);
G.requestStop(c, s);
assert.equal(G.activeLevel(s), null); assert.equal(G.route(s, 'town').at, 'market');
assert.ok(G.loopSeconds(c, s, 'town') > 2);

// --- standing orders run at day end; offline skips no-order stops ---
s = G.createState(c); s.coins = 300; G.buyUpgrade(c, s, 'orders');
G.planAdd(c, s, 'town', 'farm'); G.toggleOrder(c, s, 'town', 0, 'apples');
G.planAdd(c, s, 'town', 'bakery');
G.planAdd(c, s, 'town', 'market'); G.toggleOrder(c, s, 'town', 2, 'apples');
G.startTrip(c, s, 'town');
const c0 = s.coins; G.applyOffline(c, s, 600);
assert.ok(s.coins > c0, 'offline earned'); assert.equal(s._offline, undefined);

// --- land: horse, travel, combined market, estimates ---
s = G.createState(c); s.coins = 2000; G.buyUpgrade(c, s, 'horse');
const est = G.priceEstimate(c, s, 'kingsport', 'wine', 'sell');
assert.ok(!est.exact && est.lo <= 30 && est.hi >= 30, JSON.stringify(est));
assert.ok(G.priceEstimate(c, s, 'millbrook', 'cheese', 'sell').exact);
assert.equal(G.market(c, 'land', 'millbrook').buys.cheese, 15);   // best buyer (tavern)
assert.equal(G.market(c, 'land', 'millbrook').sells.apples, 1);
G.planAdd(c, s, 'town', 'farm'); G.startTrip(c, s, 'town');        // walking in town...
G.planAdd(c, s, 'land', 'kingsport');
assert.ok(G.startTrip(c, s, 'land'), 'land trip starts');
assert.equal(s.locals.millbrook.trip, null, 'town walk ended');
assert.equal(s.town, null);
const ev = runUntil(s, () => G.tradingAt(s), 60);
assert.equal(s.town, 'kingsport'); assert.ok(s.visited.kingsport);
assert.ok(ev.some(e => e.id === 'firstTown'));
assert.deepEqual(G.tradingAt(s), { level: 'land', id: 'kingsport' });
assert.ok(G.priceEstimate(c, s, 'kingsport', 'wine', 'sell').exact);
assert.ok(!G.canPlan(c, s, 'town'), 'cannot walk town while on land route');
G.requestStop(c, s);
assert.equal(s.land.at, 'kingsport'); assert.ok(G.canPlan(c, s, 'town'));
assert.ok(G.planAdd(c, s, 'town', 'docks'));

// --- land standing orders loop and earn offline ---
s = G.createState(c); s.coins = 3000; G.buyUpgrade(c, s, 'horse'); G.buyUpgrade(c, s, 'orders'); G.buyUpgrade(c, s, 'cart');
G.planAdd(c, s, 'land', 'vinehollow'); G.toggleOrder(c, s, 'land', 0, 'wine');
G.planAdd(c, s, 'land', 'kingsport'); G.toggleOrder(c, s, 'land', 1, 'wine');
G.startTrip(c, s, 'land');
const c1 = s.coins; G.applyOffline(c, s, 3600);
assert.ok(s.coins > c1 + 1000, 'land loop earns ' + (s.coins - c1));

// --- migration from a 0.6 town save ---
const old = JSON.stringify({ coins: 42, at: 'farm', pos: { x: 1, y: 2 }, inv: { apples: 2 }, upgrades: { pack: true }, plan: [{ b: 'market', orders: {} }], trip: null, stats: { trips: 3 } });
const m = G.deserialize(c, old);
assert.equal(m.coins, 42); assert.equal(m.locals.millbrook.at, 'farm'); assert.equal(m.locals.millbrook.plan.length, 1);
assert.equal(m.stats.trips, 3); assert.equal(m.town, 'millbrook');
const rt = G.deserialize(c, G.serialize(s)); assert.deepEqual(rt.land, s.land);
console.log('game tests passed');
{
  // hiring: management gates, hire runs its own land route with its own cargo
  const s = G.createState(c); s.coins = 50000;
  for (const u of ['horse', 'orders', 'mgmt1']) G.buyUpgrade(c, s, u);
  assert.deepEqual(G.management(c, s), { level: 1, hires: 1, stops: 2 });
  const ev = G.hire(c, s); assert.equal(ev[0].name, 'Ada'); assert.ok(ev.some(e => e.id === 'firstHire'));
  assert.equal(G.hire(c, s), null, 'only one hire at level 1');
  const L = 'hire:1';
  assert.ok(G.planAdd(c, s, L, 'vinehollow')); G.toggleOrder(c, s, L, 0, 'wine');
  assert.ok(G.planAdd(c, s, L, 'kingsport')); G.toggleOrder(c, s, L, 1, 'wine');
  assert.ok(!G.planAdd(c, s, L, 'saltmere'), 'max 2 stops');
  assert.ok(G.startTrip(c, s, L));
  assert.equal(G.activeLevel(s), null, 'player still free'); assert.equal(s.town, 'millbrook');
  const c0 = s.coins;
  for (let t = 0; t < 200; t += 0.05) G.tick(c, s, 0.05);
  assert.ok(s.coins > c0, 'hire earns ' + (s.coins - c0));
  assert.deepEqual(s.inv, {}, 'player cargo untouched');
  const c1 = s.coins; G.applyOffline(c, s, 3600); assert.ok(s.coins > c1 + 1000, 'hire earns offline');
  G.buyUpgrade(c, s, 'mgmt2'); assert.ok(G.hireCost(c, s) > 1200); assert.ok(G.hire(c, s));
  const rt = G.deserialize(c, G.serialize(s)); assert.equal(rt.hires.length, 2);
  console.log('hire tests passed');
}
{
  // land prices react to trading and recover
  const s = G.createState(c); s.coins = 5000; s.upgrades.horse = s.upgrades.wagon = true;
  s.view = 'land';
  const m = G.market(c, 'land', 'millbrook').sells, g = Object.keys(m).sort((x, y) => m[y] - m[x])[0]; // dearest good, so +1% shows
  const q0 = G.buyPrice(c, 'land', 'millbrook', g, s);
  const ev = G.tradeBuy(c, s, g, 30);
  assert.ok(ev.n >= 15 && ev.coins > q0 * ev.n, 'buying many costs more than n x base');
  assert.ok(G.buyPrice(c, 'land', 'millbrook', g, s) > q0, 'price rose');
  for (let t = 0; t < 600; t += 0.5) G.tick(c, s, 0.5);
  assert.equal(G.buyPrice(c, 'land', 'millbrook', g, s), q0, 'price recovered');
  assert.equal(G.buyPrice(c, 'town', 'farm', 'apples', s), G.buyPrice(c, 'town', 'farm', 'apples'), 'town level stays fixed');
  console.log('price tests passed');
}
{
  // instruction blocks
  const s = G.createState(c); s.coins = 90000;
  for (const u of ['horse', 'orders', 'mgmt1']) G.buyUpgrade(c, s, u);
  G.hire(c, s); const L = 'hire:1';
  G.planAdd(c, s, L, 'vinehollow'); G.planAdd(c, s, L, 'kingsport');
  assert.ok(!G.programUnlocked(c, s));
  G.buyUpgrade(c, s, 'mgmt2');
  assert.ok(G.programUnlocked(c, s) && !G.blockAllowed(c, s, 'wait'));
  G.setProgram(c, s, L, 0, [{ op: 'wait', days: 1 }, { op: 'if', good: 'wine', side: 'buy', cmp: '<', value: 999, then: [{ op: 'buy', good: 'wine', amount: 5 }] }]);
  assert.equal(s.hires[0].route.plan[0].program.length, 1, 'wait dropped below level 3');
  G.setProgram(c, s, L, 1, [{ op: 'sell', good: 'wine', amount: 'all' }, { op: 'spend', good: 'salt' }]);
  const kp = G.market(c, 'land', 'kingsport').sells;
  G.startTrip(c, s, L);
  for (let t = 0; t < 40; t += 0.05) G.tick(c, s, 0.05);
  const inv = s.hires[0].inv;
  assert.ok(!inv.wine, 'sold wine'); assert.ok(inv.salt > 0 && kp.salt, JSON.stringify(inv));
  G.hireStop(c, s, L); for (let t = 0; t < 60 && s.hires[0].route.trip; t += 0.05) G.tick(c, s, 0.05);
  G.buyUpgrade(c, s, 'mgmt3');
  assert.ok(G.setProgram(c, s, L, 0, [{ op: 'wait', days: 2 }, { op: 'if', good: 'wine', side: 'buy', cmp: 'dropped', then: [{ op: 'buy', good: 'wine', amount: 'all' }] }]));
  assert.ok(G.loopSeconds(c, s, L) > 2 * c.dayLength * 2);
  console.log('block tests passed');
}
{
  // walk straight to one building; the planned loop comes back after
  const s = G.createState(c);
  G.planAdd(c, s, 'town', 'farm'); G.planAdd(c, s, 'town', 'market');
  assert.ok(G.goTo(c, s, 'bakery'));
  for (let t = 0; t < 60 && G.activeLevel(s); t += 0.05) G.tick(c, s, 0.05);
  assert.equal(G.activeLevel(s), null); assert.equal(s.locals.millbrook.at, 'bakery');
  assert.deepEqual(s.locals.millbrook.plan.map(p => p.b), ['farm', 'market']);
  assert.deepEqual(G.tradingAt(s), { level: 'town', id: 'bakery' });
  assert.ok(!G.goTo(c, s, 'bakery'), 'already there');
  console.log('goto tests passed');
}
{
  // bulky goods, stays, quick dealings, drift bounds, hires share your upgrades
  let s = G.createState(c); s.coins = 100;
  G.goTo(c, s, 'dairy'); for (let t = 0; t < 30 && G.activeLevel(s); t += 0.05) G.tick(c, s, 0.05);
  assert.equal(G.maxBuy(c, s, 'cheese'), 1, '3 slots hold one 2-slot cheese');
  G.tradeBuy(c, s, 'cheese', 9); assert.equal(G.carried(s, c), 2);
  // hand stop pauses ~1s; orders stop a day, shortened by Quick dealings
  s = G.createState(c); s.coins = 9999; s.upgrades.orders = true;
  G.planAdd(c, s, 'town', 'farm'); G.planAdd(c, s, 'town', 'market'); G.toggleOrder(c, s, 'town', 1, 'apples');
  G.startTrip(c, s, 'town');
  for (let t = 0; t < 30 && !G.tradingAt(s); t += 0.05) G.tick(c, s, 0.05);
  assert.equal(G.route(s, 'town').trip.stayTotal, c.handStay);
  const L0 = G.loopSeconds(c, s, 'town'); s.upgrades.quick1 = true;
  assert.ok(G.loopSeconds(c, s, 'town') < L0);
  s.upgrades.quick3 = true; assert.ok(G.autoWait(c, s) < 0.1);
  // drift stays within bounds and moves prices
  c.prices.drift = drift0; s = G.createState(c);
  for (let t = 0; t < 3600; t += 1) G.tick(c, s, 1);
  const all = Object.values(s.drift).flatMap(o => Object.values(o));
  assert.ok(all.length > 20 && all.every(v => Math.abs(v) <= drift0.amp + 1e-9) && all.some(v => v !== 0));
  c.prices.drift = { ...drift0, amp: 0 };
  // hires use your capacity
  s = G.createState(c); s.coins = 1e6; Object.assign(s.upgrades, { horse: true, orders: true, mgmt1: true, wagon: true });
  G.hire(c, s); G.planAdd(c, s, 'hire:1', 'vinehollow'); G.toggleOrder(c, s, 'hire:1', 0, 'wine'); G.planAdd(c, s, 'hire:1', 'kingsport');
  G.startTrip(c, s, 'hire:1'); for (let t = 0; t < 60 && !s.hires[0].inv.wine; t += 0.05) G.tick(c, s, 0.05);
  assert.equal(s.hires[0].inv.wine, 40);
  console.log('rework tests passed');
}
