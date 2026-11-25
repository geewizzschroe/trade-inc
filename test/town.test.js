import fs from 'node:fs';
import assert from 'node:assert/strict';
import * as T from '../js/town.js';
const c = JSON.parse(fs.readFileSync(new URL('../data/town.json', import.meta.url)));
c.routeMode = 'once'; c.stopMode = 'orders'; c.prices.mode = 'reactive'; // most checks below use single trips with reactive prices
const run = (s, secs) => { const ev = []; for (let i = 0; i < secs * 20; i++) ev.push(...T.tick(c, s, 0.05)); return ev; };

let s = T.createState(c);
assert.equal(s.coins, 5); assert.equal(T.capacity(c, s), 3);
// plan: farm (buy apples) -> market (sell apples)
assert.ok(T.planAdd(c, s, 'farm'));
assert.ok(!T.planAdd(c, s, 'farm'), 'no repeat stop');
T.toggleOrder(c, s, 0, 'apples');
assert.equal(s.plan[0].orders.apples, 'buy');
assert.ok(T.planAdd(c, s, 'market'));
assert.equal(s.plan[1].orders.apples, 'sell');
assert.ok(T.startTrip(s));
assert.ok(!T.planAdd(c, s, 'tavern'), 'cannot plan while walking');
const ev = run(s, 20);
assert.equal(s.trip, null); assert.equal(s.at, 'market');
assert.equal(s.inv.apples, undefined);
assert.ok(s.coins > 5, 'profit ' + s.coins);
assert.ok(ev.some(e => e.type === 'achievement' && e.id === 'firstProfit'));
// reactive prices dropped at market, then recover
const p0 = T.sellPrice(c, s, 'market', 'apples');
assert.ok(p0 <= 4);
run(s, 300);
assert.equal(T.sellPrice(c, s, 'market', 'apples'), 4);
// capacity respected
s.coins = 1000; s.plan = []; T.planAdd(c, s, 'farm'); T.toggleOrder(c, s, 0, 'wheat'); T.toggleOrder(c, s, 0, 'milk');
T.startTrip(s); run(s, 20);
assert.equal(T.carried(s), 3);
// hurry speeds things up
const s2 = T.createState(c); T.planAdd(c, s2, 'tavern'); T.startTrip(s2);
T.tick(c, s2, 0.1); const before = s2.trip.leg; T.hurry(c, s2); assert.equal(s2.trip.leg, before + c.hurryDistance);
// upgrades + achievement
const s3 = T.createState(c); s3.coins = 600;
const e3 = T.buyUpgrade(c, s3, 'horse');
assert.ok(e3.some(e => e.id === 'horseBeforeCart'));
assert.equal(T.buyUpgrade(c, s3, 'horse'), null);
s3.coins = 200; T.buyUpgrade(c, s3, 'cart'); assert.equal(T.capacity(c, s3), 15);
// save roundtrip, including mid-trip
const s4 = T.deserialize(c, T.serialize(s2));
assert.deepEqual(s4.trip, s2.trip);
assert.throws(() => T.deserialize(c, '{"coins":1}'));
// loop mode keeps walking, stop request ends at next building, offline earns
const cl = { ...c, routeMode: 'loop', stopMode: 'orders', prices: { ...c.prices, mode: 'fixed' } };
const s5 = T.createState(cl); T.planAdd(cl, s5, 'farm'); T.toggleOrder(cl, s5, 0, 'apples'); T.planAdd(cl, s5, 'market');
T.startTrip(s5); run.call(null, s5, 0);
for (let i = 0; i < 600; i++) T.tick(cl, s5, 0.05);
assert.ok(s5.trip, 'still looping'); assert.ok(s5.stats.trips >= 2, 'laps ' + s5.stats.trips);
assert.equal(T.sellPrice(cl, s5, 'market', 'apples'), 4, 'fixed price');
const g = T.applyOffline(cl, s5, 600); assert.ok(g > 0, 'offline gain ' + g);
T.requestStop(s5); for (let i = 0; i < 400 && s5.trip; i++) T.tick(cl, s5, 0.05);
assert.equal(s5.trip, null); assert.ok(['farm', 'market'].includes(s5.at));
// manual trading: merchant waits at each stop
const cm = { ...c, routeMode: 'loop', stopMode: 'manual', prices: { ...c.prices, mode: 'fixed' } };
const s6 = T.createState(cm);
assert.equal(T.tradingAt(s6), 'market');
T.planAdd(cm, s6, 'farm'); T.planAdd(cm, s6, 'market'); T.startTrip(s6);
assert.equal(T.tradingAt(s6), null);
for (let i = 0; i < 200; i++) T.tick(cm, s6, 0.05);
assert.ok(s6.trip.waiting); assert.equal(T.tradingAt(s6), 'farm');
assert.equal(T.tradeBuy(cm, s6, 'apples', 1e9).n, 3);
assert.equal(T.tradeBuy(cm, s6, 'wheat'), null, 'bag full');
assert.equal(T.tradeSell(cm, s6, 'apples'), null, 'farm does not buy apples');
T.continueTrip(cm, s6);
for (let i = 0; i < 200; i++) T.tick(cm, s6, 0.05);
assert.equal(T.tradingAt(s6), 'market');
assert.equal(T.tradeSell(cm, s6, 'apples', 1e9).coins, 12);
T.requestStop(s6); T.tick(cm, s6, 0.05);
assert.equal(s6.trip, null); assert.equal(s6.at, 'market');
// standing orders upgrade: stops with orders trade by themselves
const s7 = T.createState(cm); s7.coins = 200;
T.buyUpgrade(cm, s7, 'orders'); assert.ok(T.ordersUnlocked(cm, s7));
T.planAdd(cm, s7, 'farm'); T.toggleOrder(cm, s7, 0, 'apples'); T.planAdd(cm, s7, 'market'); T.toggleOrder(cm, s7, 1, 'apples');
T.startTrip(s7); const c0 = s7.coins;
T.applyOffline(cm, s7, 300);
assert.ok(s7.coins > c0, 'orders loop earns offline'); assert.ok(!s7.trip.waiting);
// offline: a stop with no orders is walked past instead of waiting
const s8 = T.createState(cm); s8.coins = 200; T.buyUpgrade(cm, s8, 'orders');
T.planAdd(cm, s8, 'farm'); T.toggleOrder(cm, s8, 0, 'apples');
T.planAdd(cm, s8, 'bakery');                       // no orders
T.planAdd(cm, s8, 'market'); T.toggleOrder(cm, s8, 2, 'apples');
T.startTrip(s8);
for (let i = 0; i < 400 && !s8.trip.waiting; i++) T.tick(cm, s8, 0.05);
assert.ok(s8.trip.waiting, 'waits at bakery while open');
const c8 = s8.coins; T.applyOffline(cm, s8, 600);
assert.ok(s8.coins > c8, 'earns offline past the no-order stop'); assert.ok(s8.stats.trips >= 3);
assert.equal(s8._offline, undefined);
// a route with no orders at all earns nothing offline and stays put
const s9 = T.createState(cm); T.planAdd(cm, s9, 'farm'); T.startTrip(s9);
assert.equal(T.applyOffline(cm, s9, 600), 0);
console.log('town tests passed');
