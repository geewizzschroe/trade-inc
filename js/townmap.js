// Canvas view of the town: buildings, paths, the planned route and the merchant. Read-only on state.
import * as G from './game.js';

export class TownMap {
  constructor(canvas, content, getState) {
    this.c = canvas; this.ctx = canvas.getContext('2d'); this.level = 'town';
    this.content = content; this.getState = getState;
    this.bounce = {}; this.puffs = [];
    this.resize();
  }

  resize() {
    if (!this.c.getBoundingClientRect().width) return;
    const r = this.c.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    this.w = r.width; this.h = r.height;
    this.c.width = Math.round(r.width * dpr); this.c.height = Math.round(r.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const pad = 70; // world units around the town
    this.scale = Math.min(this.w / (1000 + pad * 2), this.h / (1000 + pad * 2));
    this.ox = (this.w - 1000 * this.scale) / 2; this.oy = (this.h - 1000 * this.scale) / 2;
  }

  toScreen(x, y) { return [this.ox + x * this.scale, this.oy + y * this.scale]; }
  pagePos(x, y) { const r = this.c.getBoundingClientRect(), [sx, sy] = this.toScreen(x, y); return [r.left + sx, r.top + sy]; }
  get bld() { return this.content.towns[G.currentTown(this.getState())].buildings; }
  get r() { return G.route(this.getState(), 'town'); }
  nodePagePos(b) { const d = this.bld[b]; return d ? this.pagePos(d.x, d.y) : null; }
  merchantPagePos() { const p = this.merchantPos(); return this.pagePos(p.x, p.y); }
  // During a land stop the merchant stands at the town's first building.
  merchantPos() { const s = this.getState(); if (s.land.trip) { const b = Object.values(this.bld)[0]; return { x: b.x, y: b.y }; } return this.r.pos; }

  hitNode(px, py) {
    const r = this.c.getBoundingClientRect(), x = px - r.left, y = py - r.top;
    let best = null, bestD = Math.max(36, 90 * this.scale);
    for (const id in this.bld) {
      const d = this.bld[id], [sx, sy] = this.toScreen(d.x, d.y);
      const dist = Math.hypot(sx - x, sy - y);
      if (dist < bestD) { bestD = dist; best = id; }
    }
    return best;
  }

  poke(b) { this.bounce[b] = 0; }
  puff() { const p = this.merchantPos(); this.puffs.push({ x: p.x, y: p.y, t: 0, dx: Math.random() * 30 - 15 }); }

  draw(dt, now) {
    const ctx = this.ctx, c = this.content, st0 = this.getState(), S = this.scale;
    const B = this.bld, r = this.r, town = c.towns[G.currentTown(st0)];
    const s = { plan: r.plan, trip: r.trip, at: r.at, pos: this.merchantPos(), upgrades: st0.upgrades };
    ctx.fillStyle = '#2f4a2f'; ctx.fillRect(0, 0, this.w, this.h);
    // grass speckle
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    for (let i = 0; i < 90; i++) { const x = (i * 197) % 1000, y = (i * 331) % 1000; const [sx, sy] = this.toScreen(x, y); ctx.fillRect(sx, sy, 2, 2); }

    // dirt paths from the market to every building, and around the edge
    const ids = Object.keys(B), hub = B[ids[0]];
    ctx.lineCap = 'round';
    const path = (a, b, w) => { const [x1, y1] = this.toScreen(a.x, a.y), [x2, y2] = this.toScreen(b.x, b.y); ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); };
    ctx.strokeStyle = '#6b5a3e';
    for (const id of ids.slice(1)) path(hub, B[id], 34 * S);
    const ring = ids.slice(1);
    if (ring.length > 2) for (let i = 0; i < ring.length; i++) path(B[ring[i]], B[ring[(i + 1) % ring.length]], 22 * S);
    // plaza
    { const [x, y] = this.toScreen(hub.x, hub.y); ctx.fillStyle = '#7a6a50'; ctx.beginPath(); ctx.arc(x, y, 120 * S, 0, Math.PI * 2); ctx.fill(); }

    // planned route
    if (s.plan.length) {
      const pts = [];
      const startB = s.trip ? s.trip.from : s.at;
      pts.push(B[startB]);
      for (const st of s.plan) pts.push(B[st.b]);
      ctx.save();
      ctx.setLineDash([10, 8]); ctx.lineDashOffset = -now / 40;
      ctx.strokeStyle = 'rgba(245,197,66,0.9)'; ctx.lineWidth = 4;
      ctx.beginPath();
      pts.forEach((p, i) => { const [x, y] = this.toScreen(p.x, p.y); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.stroke(); ctx.restore();
    }

    // buildings
    const size = 120 * S;
    for (const id of ids) {
      const d = B[id];
      let [x, y] = this.toScreen(d.x, d.y);
      let k = 1;
      if (this.bounce[id] != null) { const t = this.bounce[id] += dt; k = 1 + Math.sin(Math.min(t / 0.35, 1) * Math.PI) * 0.15; if (t > 0.35) delete this.bounce[id]; }
      const sz = size * k;
      ctx.fillStyle = 'rgba(0,0,0,0.35)'; roundRect(ctx, x - sz / 2 + 3, y - sz / 2 + 5, sz, sz, 10); ctx.fill();
      ctx.fillStyle = d.color; roundRect(ctx, x - sz / 2, y - sz / 2, sz, sz, 10); ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.stroke();
      ctx.font = `${Math.round(sz * 0.55)}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(d.icon, x, y + 1);
      ctx.textBaseline = 'alphabetic';
      label(ctx, d.name, x, y - sz / 2 - 6, '600 12px system-ui', '#f0e6d2');
      // goods: green = you can buy here, gold = they buy from you
      const parts = [];
      for (const g in d.sells) parts.push({ t: c.goods[g].icon + d.sells[g], col: '#8fe0a2' });
      for (const g in d.buys) parts.push({ t: c.goods[g].icon + d.buys[g], col: '#f5c542' });
      ctx.font = '600 11px system-ui';
      const widths = parts.map(p => ctx.measureText(p.t).width + 6), total = widths.reduce((a, b) => a + b, 0);
      let gx = x - total / 2;
      parts.forEach((p, i) => { label(ctx, p.t, gx + widths[i] / 2, y + sz / 2 + 15, '600 11px system-ui', p.col); gx += widths[i]; });
      // numbered stop markers
      s.plan.forEach((st, i) => {
        if (st.b !== id) return;
        const done = s.trip && i < s.trip.idx;
        const mx = x + sz / 2 - 2 + (i % 3) * 4, my = y - sz / 2 + 2 + Math.floor(i / 3) * 4;
        ctx.beginPath(); ctx.arc(mx, my, 10, 0, Math.PI * 2);
        ctx.fillStyle = done ? '#55606b' : '#f5c542'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#1a1a1a'; ctx.stroke();
        ctx.fillStyle = '#1a1a1a'; ctx.font = '700 11px system-ui'; ctx.textAlign = 'center'; ctx.fillText(String(i + 1), mx, my + 4);
      });
    }

    // the current visit's day, as a ring around the building
    if (s.trip?.atStop) {
      const d = B[s.plan[s.trip.idx].b], [x, y] = this.toScreen(d.x, d.y);
      const f = 1 - Math.max(0, s.trip.stay) / c.dayLength;
      ctx.beginPath(); ctx.arc(x, y, size * 0.8, -Math.PI / 2, -Math.PI / 2 + f * Math.PI * 2);
      ctx.lineWidth = 5; ctx.strokeStyle = s.trip.manual ? '#8fe0a2' : '#f5c542'; ctx.lineCap = 'round'; ctx.stroke();
    }

    // dust puffs from hurrying
    this.puffs = this.puffs.filter(p => (p.t += dt) < 0.5);
    for (const p of this.puffs) {
      const [x, y] = this.toScreen(p.x, p.y);
      ctx.globalAlpha = 1 - p.t / 0.5; ctx.font = '16px system-ui'; ctx.textAlign = 'center';
      ctx.fillText('💨', x + p.dx - p.t * 40, y + 10 - p.t * 20); ctx.globalAlpha = 1;
    }

    // merchant
    const [mx, my] = this.toScreen(s.pos.x, s.pos.y);
    const walking = s.trip && !s.trip.atStop;
    const bob = walking ? Math.abs(Math.sin(now / 90)) * 4 : 0;
    let faceRight = false;
    if (s.trip && !s.trip.atStop) { const to = B[s.plan[s.trip.idx].b]; faceRight = to.x > s.pos.x; }
    const idle = !s.trip || st0.land.trip;
    const offX = idle ? size * 0.62 : 0, offY = idle ? size * 0.15 : 0; // stand beside the building when idle
    ctx.save(); ctx.translate(mx + offX, my + offY - bob);
    if (faceRight) ctx.scale(-1, 1);
    ctx.font = '26px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (s.upgrades.cart) ctx.fillText('🛒', 22, 4);
    ctx.fillText(s.upgrades.horse ? '🏇' : '🚶', 0, 0);
    ctx.restore(); ctx.textBaseline = 'alphabetic';
    ctx.font = '700 15px system-ui';
    const tl = town.icon + ' ' + town.name;
    label(ctx, tl, 12 + ctx.measureText(tl).width / 2, 24, '700 15px system-ui', '#f0e6d2');
  }
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
export function label(ctx, text, x, y, font, color) {
  ctx.font = font; ctx.textAlign = 'center';
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.strokeText(text, x, y);
  ctx.fillStyle = color; ctx.fillText(text, x, y);
}
