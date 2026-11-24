import fs from 'node:fs';
import assert from 'node:assert/strict';
import * as E from '../js/engine.js';
const content = JSON.parse(fs.readFileSync(new URL('../data/content.json', import.meta.url)));

let s = E.createState(content);
assert.equal(s.routes.grain.unlocked, true);
assert.equal(s.routes.timber.unlocked, false);
// manual trip
assert.equal(E.tap(content, s, 'grain'), 'started');
let ev = E.tick(content, s, 2);
assert.equal(ev.length, 1); assert.equal(s.coins, 1); assert.equal(s.routes.grain.running, false);
// hire
s.coins = 100;
assert.ok(E.hire(content, s, 'grain', 1));
assert.ok(Math.abs(s.coins - 96) < 1e-9);
// geometric cost matches sum
const def = E.routeDef(content, 'grain');
let sum = 0; for (let i = 0; i < 5; i++) sum += E.caravanCost(def, 3 + i, 1);
assert.ok(Math.abs(sum - E.caravanCost(def, 3, 5)) < 1e-6);
const m = E.maxAffordable(def, 3, 1000);
assert.ok(E.caravanCost(def, 3, m) <= 1000 && E.caravanCost(def, 3, m + 1) > 1000);
// auto running, many trips per tick
s.routes.grain.caravans = 10; s.coins = 0;
E.tick(content, s, 10);
const T = E.tripTime(content, def, s.routes.grain);
assert.equal(T, 0.75);
assert.ok(Math.abs(s.coins - Math.floor(10 / T) * 10) < 1e-6, 'coins ' + s.coins);
// offline
const before = s.coins;
const got = E.applyOffline(content, s, 3600);
assert.ok(got > 0 && s.coins === before + got);
// save roundtrip + missing fields tolerated
const s2 = E.deserialize(content, E.serialize(s));
assert.deepEqual(s2.routes, s.routes);
const old = E.deserialize(content, JSON.stringify({ coins: 5, routes: { grain: { unlocked: true, caravans: 2 } } }));
assert.equal(old.routes.silk.unlocked, false); assert.equal(old.routes.grain.progress, 0);
assert.throws(() => E.deserialize(content, '{"x":1}'));
// unlock
s.coins = 50; assert.ok(E.unlock(content, s, 'timber')); assert.equal(s.coins, 0);
assert.equal(E.formatNumber(1234), '1.23K'); assert.equal(E.formatNumber(5.5), '5.5');
console.log('engine tests passed');
