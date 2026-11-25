import fs from 'node:fs';
import assert from 'node:assert/strict';
import * as T from '../js/town.js';
const c = JSON.parse(fs.readFileSync(new URL('../data/town.json', import.meta.url)));
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
console.log('town tests passed');
