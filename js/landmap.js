// Canvas view of the land: towns as nodes, roads, the planned land route and the rider.
import * as G from './game.js';
import { label } from './townmap.js';

export class LandMap {
  constructor(canvas, content, getState) {
    this.c = canvas; this.ctx = canvas.getContext('2d'); this.level = 'land';
    this.content = content; this.getState = getState;
    this.bounce = {}; this.puffs = []; this.selected = null;
    this.roads = buildRoads(content.towns);
    this.resize();
  }

  resize() {
    const r = this.c.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    if (!r.width) return;
    this.w = r.width; this.h = r.height;
    this.c.width = Math.round(r.width * dpr); this.c.height = Math.round(r.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const pad = 90;
    this.scale = Math.min(this.w / (1000 + pad * 2), this.h / (1000 + pad * 2));
    this.ox = (this.w - 1000 * this.scale) / 2; this.oy = (this.h - 1000 * this.scale) / 2;
  }

  toScreen(x, y) { return [this.ox + x * this.scale, this.oy + y * this.scale]; }
  pagePos(x, y) { const r = this.c.getBoundingClientRect(), [sx, sy] = this.toScreen(x, y); return [r.left + sx, r.top + sy]; }
  nodePagePos(id) { const t = this.content.towns[id]; return t ? this.pagePos(t.x, t.y) : null; }
  merchantPagePos() { const p = this.getState().land.pos; return this.pagePos(p.x, p.y); }

  hitNode(px, py) {
    const r = this.c.getBoundingClientRect(), x = px - r.left, y = py - r.top;
    let best = null, bestD = 40;
    for (const id in this.content.towns) {
      const t = this.content.towns[id], [sx, sy] = this.toScreen(t.x, t.y);
      const d = Math.hypot(sx - x, sy - y);
      if (d < bestD) { bestD = d; best = id; }
    }
    return best;
  }

  poke(id) { this.bounce[id] = 0; }
  puff() { const p = this.getState().land.pos; this.puffs.push({ x: p.x, y: p.y, t: 0, dx: Math.random() * 30 - 15 }); }

  draw(dt, now) {
    const ctx = this.ctx, c = this.content, st = this.getState(), r = st.land, S = this.scale;
    // sea and land
    ctx.fillStyle = '#16304a'; ctx.fillRect(0, 0, this.w, this.h);
    ctx.beginPath();
    smooth(ctx, LAND.map(p => this.toScreen(p[0], p[1])));
    ctx.fillStyle = '#3a5a3a'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = '#4f7350'; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    for (let i = 0; i < 70; i++) {
      const x = (i * 263) % 1000, y = (i * 419) % 1000;
      if (!inside(LAND, x, y)) continue;
      const [sx, sy] = this.toScreen(x, y), k = 7;
      ctx.beginPath(); ctx.moveTo(sx, sy - k); ctx.lineTo(sx + k, sy + k * .6); ctx.lineTo(sx - k, sy + k * .6); ctx.fill();
    }
    // roads
    ctx.lineCap = 'round'; ctx.strokeStyle = '#6b5a3e'; ctx.lineWidth = Math.max(3, 14 * S);
    for (const [a, b] of this.roads) {
      const A = c.towns[a], B = c.towns[b];
      const [x1, y1] = this.toScreen(A.x, A.y), [x2, y2] = this.toScreen(B.x, B.y);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
    // planned route
    if (r.plan.length) {
      const pts = [c.towns[r.trip ? r.trip.from : r.at], ...r.plan.map(p => c.towns[p.b])];
      ctx.save(); ctx.setLineDash([10, 8]); ctx.lineDashOffset = -now / 40;
      ctx.strokeStyle = 'rgba(245,197,66,0.95)'; ctx.lineWidth = 4; ctx.beginPath();
      pts.forEach((p, i) => { const [x, y] = this.toScreen(p.x, p.y); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.stroke(); ctx.restore();
    }
    // towns
    const here = st.town;
    for (const id in c.towns) {
      const t = c.towns[id];
      let [x, y] = this.toScreen(t.x, t.y), k = 1;
      if (this.bounce[id] != null) { const b = this.bounce[id] += dt; k = 1 + Math.sin(Math.min(b / 0.35, 1) * Math.PI) * 0.18; if (b > 0.35) delete this.bounce[id]; }
      const rad = 22 * k;
      if (id === this.selected) { ctx.beginPath(); ctx.arc(x, y, rad + 7, 0, Math.PI * 2); ctx.fillStyle = 'rgba(245,197,66,0.35)'; ctx.fill(); }
      ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2);
      ctx.fillStyle = st.visited[id] ? '#f0e6d2' : '#a9b8c6'; ctx.fill();
      ctx.lineWidth = id === here ? 4 : 2.5; ctx.strokeStyle = id === here ? '#f5c542' : '#1a1a1a'; ctx.stroke();
      ctx.font = `${Math.round(rad * 1.1)}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(t.icon, x, y + 1); ctx.textBaseline = 'alphabetic';
      label(ctx, t.name + (st.visited[id] ? '' : ' ?'), x, y + rad + 15, '600 12px system-ui', '#f0e6d2');
      r.plan.forEach((p, i) => {
        if (p.b !== id) return;
        const done = r.trip && i < r.trip.idx;
        const mx = x + rad - 2 + (i % 3) * 4, my = y - rad + 2 + Math.floor(i / 3) * 4;
        ctx.beginPath(); ctx.arc(mx, my, 10, 0, Math.PI * 2);
        ctx.fillStyle = done ? '#55606b' : '#f5c542'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#1a1a1a'; ctx.stroke();
        ctx.fillStyle = '#1a1a1a'; ctx.font = '700 11px system-ui'; ctx.textAlign = 'center'; ctx.fillText(String(i + 1), mx, my + 4);
      });
    }
    // day ring at the current stop
    if (r.trip?.atStop) {
      const t = c.towns[r.plan[r.trip.idx].b], [x, y] = this.toScreen(t.x, t.y);
      const f = 1 - Math.max(0, r.trip.stay) / c.dayLength;
      ctx.beginPath(); ctx.arc(x, y, 31, -Math.PI / 2, -Math.PI / 2 + f * Math.PI * 2);
      ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.strokeStyle = r.trip.manual ? '#8fe0a2' : '#f5c542'; ctx.stroke();
    }
    // dust
    this.puffs = this.puffs.filter(p => (p.t += dt) < 0.5);
    for (const p of this.puffs) {
      const [x, y] = this.toScreen(p.x, p.y);
      ctx.globalAlpha = 1 - p.t / 0.5; ctx.font = '16px system-ui'; ctx.textAlign = 'center';
      ctx.fillText('💨', x + p.dx - p.t * 40, y + 10 - p.t * 20); ctx.globalAlpha = 1;
    }
    // rider
    if (G.landUnlocked(c, st)) {
      const [mx, my] = this.toScreen(r.pos.x, r.pos.y);
      const moving = r.trip && !r.trip.atStop;
      const bob = moving ? Math.abs(Math.sin(now / 80)) * 3 : 0;
      let right = false;
      if (moving) right = c.towns[r.plan[r.trip.idx].b].x > r.pos.x;
      ctx.save(); ctx.translate(mx + (moving ? 0 : 26), my - (moving ? 12 : 22) - bob);
      if (right) ctx.scale(-1, 1);
      ctx.font = '24px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      if (st.upgrades.cart || st.upgrades.wagon) ctx.fillText(st.upgrades.wagon ? '🚚' : '🛒', 22, 4);
      ctx.fillText('🏇', 0, 0); ctx.restore(); ctx.textBaseline = 'alphabetic';
    }
    ctx.font = '700 15px system-ui';
    label(ctx, '🗺️ The land', 12 + ctx.measureText('🗺️ The land').width / 2, 24, '700 15px system-ui', '#f0e6d2');
  }
}

const LAND = [[60,60],[420,30],[760,60],[960,120],[990,420],[940,640],[820,780],[640,900],[420,960],[120,960],[40,700],[30,360]];

// Connect each town to its two nearest neighbours.
function buildRoads(towns) {
  const ids = Object.keys(towns), set = new Set(), out = [];
  for (const a of ids) {
    const near = ids.filter(b => b !== a).sort((p, q) => dist(towns[a], towns[p]) - dist(towns[a], towns[q])).slice(0, 2);
    for (const b of near) { const k = [a, b].sort().join('|'); if (!set.has(k)) { set.add(k); out.push([a, b]); } }
  }
  return out;
}
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function smooth(ctx, pts) {
  const n = pts.length, mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const m = mid(pts[n - 1], pts[0]); ctx.moveTo(m[0], m[1]);
  for (let i = 0; i < n; i++) { const q = mid(pts[i], pts[(i + 1) % n]); ctx.quadraticCurveTo(pts[i][0], pts[i][1], q[0], q[1]); }
  ctx.closePath();
}
function inside(poly, x, y) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}
