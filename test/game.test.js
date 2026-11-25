import fs from 'node:fs';
import assert from 'node:assert/strict';
import * as G from '../js/game.js';
const c = JSON.parse(fs.readFileSync(new URL('../data/world.json', import.meta.url)));
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
assert.ok(G.loopSeconds(c, s, 'town') > 12);

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
