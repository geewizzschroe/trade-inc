// Canvas map: towns, lanes, and the caravan swarm. Reads state, never changes it.
import * as E from './engine.js';

const SEA = '#16304a', LAND = '#2c4838', LAND_EDGE = '#3d5c47', ROAD = '#5b4a33';

export class MapView {
  constructor(canvas, content, getState) {
    this.c = canvas; this.ctx = canvas.getContext('2d');
    this.content = content; this.getState = getState;
    this.cam = null; // {x, y, scale}
    this.phase = {}; this.rings = [];
    this.lanes = {};
    for (const def of content.routes) this.lanes[def.id] = buildLane(content, def);
    this.texture = buildTexture(content.map.land);
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  resize() {
    const r = this.c.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    this.w = r.width; this.h = r.height;
    this.c.width = Math.round(r.width * dpr); this.c.height = Math.round(r.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.cam = null;
  }

  // Towns to show: the hub, every open route's towns, and the next locked route's town.
  visible() {
    const st = this.getState(), towns = new Set([this.content.map.hub]), lanes = [];
    let next = null;
    for (const def of this.content.routes) {
      const rs = st.routes[def.id];
      if (rs.unlocked) { lanes.push(def); towns.add(def.from); towns.add(def.to); }
      else if (!next) { next = def; towns.add(def.from); towns.add(def.to); }
    }
    return { towns, lanes, next };
  }

  targetCam(towns) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const id of towns) { const t = this.content.towns[id]; x0 = Math.min(x0, t.x); y0 = Math.min(y0, t.y); x1 = Math.max(x1, t.x); y1 = Math.max(y1, t.y); }
    const pad = 110, minSpan = 380;
    let w = Math.max(x1 - x0 + pad * 2, minSpan), h = Math.max(y1 - y0 + pad * 2, minSpan);
    const scale = Math.min(this.w / w, this.h / h);
    return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, scale };
  }

  toScreen(x, y) { if (!this.cam) this.cam = this.targetCam(this.visible().towns); const k = this.cam; return [(x - k.x) * k.scale + this.w / 2, (y - k.y) * k.scale + this.h / 2]; }

  // Page coordinates of a point near the end of a lane, for floating text.
  lanePagePos(routeId, p) {
    if (!this.cam) this.cam = this.targetCam(this.visible().towns);
    const r = this.c.getBoundingClientRect(), [x, y] = this.toScreen(...this.lanes[routeId].at(p, 0));
    return [r.left + x, r.top + y];
  }

  // Page coordinates of a town, for floating text.
  townPagePos(id) {
    const t = this.content.towns[id], r = this.c.getBoundingClientRect();
    const [x, y] = this.toScreen(t.x, t.y);
    return [r.left + x, r.top + y];
  }

  hitTest(px, py) {
    const r = this.c.getBoundingClientRect(), x = px - r.left, y = py - r.top;
    let best = null, bestD = 30;
    for (const def of this.visible().lanes) {
      for (const p of this.lanes[def.id].pts) {
        const [sx, sy] = this.toScreen(p[0], p[1]);
        const d = Math.hypot(sx - x, sy - y);
        if (d < bestD) { bestD = d; best = def.id; }
      }
      const t = this.content.towns[def.from], [sx, sy] = this.toScreen(t.x, t.y);
      if (Math.hypot(sx - x, sy - y) < 34) return def.id;
    }
    return best;
  }

  arrive(routeId) {
    const def = this.content.routes.find(r => r.id === routeId);
    if (this.rings.length < 12) this.rings.push({ town: def.to, t: 0, color: def.color });
  }

  draw(dt, now) {
    const ctx = this.ctx, st = this.getState(), vis = this.visible();
    const tgt = this.targetCam(vis.towns);
    if (!this.cam) this.cam = { ...tgt };
    const k = 1 - Math.exp(-dt * 2.5);
    this.cam.x += (tgt.x - this.cam.x) * k; this.cam.y += (tgt.y - this.cam.y) * k; this.cam.scale += (tgt.scale - this.cam.scale) * k;
    const S = this.cam.scale;

    ctx.fillStyle = SEA; ctx.fillRect(0, 0, this.w, this.h);
    // land
    ctx.beginPath();
    smoothPoly(ctx, this.content.map.land.map(p => this.toScreen(p[0], p[1])));
    ctx.fillStyle = LAND; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = LAND_EDGE; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    for (const [x, y, s] of this.texture) { const [sx, sy] = this.toScreen(x, y); ctx.beginPath(); ctx.moveTo(sx, sy - s * S); ctx.lineTo(sx + s * S, sy + s * S * .6); ctx.lineTo(sx - s * S, sy + s * S * .6); ctx.fill(); }

    // next (locked) lane: dashed hint
    if (vis.next) {
      ctx.save(); ctx.setLineDash([6, 8]); ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(240,230,210,0.25)';
      this.strokeLane(vis.next.id); ctx.restore();
    }
    // roads
    for (const def of vis.lanes) {
      const n = st.routes[def.id].caravans;
      const w = 5 + Math.min(12, Math.log2(n + 1) * 1.8);
      ctx.lineCap = 'round';
      ctx.lineWidth = w + 3; ctx.strokeStyle = 'rgba(0,0,0,0.35)'; this.strokeLane(def.id);
      ctx.lineWidth = w; ctx.strokeStyle = ROAD; this.strokeLane(def.id);
    }
    // caravans
    for (const def of vis.lanes) this.drawSwarm(def, st.routes[def.id], dt, now);

    // arrival rings
    this.rings = this.rings.filter(r => (r.t += dt) < 0.6);
    for (const r of this.rings) {
      const t = this.content.towns[r.town], [sx, sy] = this.toScreen(t.x, t.y);
      ctx.beginPath(); ctx.arc(sx, sy, 10 + r.t * 50, 0, Math.PI * 2);
      ctx.lineWidth = 3; ctx.strokeStyle = hexA(r.color, 1 - r.t / 0.6); ctx.stroke();
    }

    // towns
    for (const id of vis.towns) {
      const t = this.content.towns[id], [sx, sy] = this.toScreen(t.x, t.y);
      const locked = vis.next && (id === vis.next.from) && !vis.lanes.some(d => d.from === id || d.to === id);
      const hub = id === this.content.map.hub;
      const rad = hub ? 13 : 9;
      ctx.beginPath(); ctx.arc(sx, sy, rad, 0, Math.PI * 2);
      ctx.fillStyle = locked ? '#55606b' : '#f0e6d2'; ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = '#1a1a1a'; ctx.stroke();
      if (hub) { ctx.beginPath(); ctx.arc(sx, sy, 5, 0, Math.PI * 2); ctx.fillStyle = '#e09b1a'; ctx.fill(); }
      const label = locked ? `🔒 ${E.formatNumber(vis.next.unlockCost)}` : t.name;
      ctx.font = `600 ${hub ? 13 : 12}px system-ui, sans-serif`; ctx.textAlign = 'center';
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.strokeText(label, sx, sy + rad + 15);
      ctx.fillStyle = locked ? '#a9b8c6' : '#f0e6d2'; ctx.fillText(label, sx, sy + rad + 15);
    }
  }

  strokeLane(id) {
    const ctx = this.ctx, pts = this.lanes[id].pts;
    ctx.beginPath();
    pts.forEach((p, i) => { const [x, y] = this.toScreen(p[0], p[1]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.stroke();
  }

  drawSwarm(def, rs, dt, now) {
    const ctx = this.ctx, lane = this.lanes[def.id];
    const T = E.tripTime(this.content, def, rs);
    if (rs.caravans === 0) {
      // the single manual camel
      const p = rs.running ? rs.progress : 0;
      const [x, y] = this.toScreen(...lane.at(p, 0));
      const bob = rs.running ? Math.sin(now / 80) * 1.5 : Math.sin(now / 300) * 2;
      ctx.font = '20px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('🐫', x, y - 8 + bob); ctx.textBaseline = 'alphabetic';
      return;
    }
    // Visual speed is capped so dots stay readable; extra speed shows up as more dots.
    const minVisual = lane.len / 260;
    const visualT = Math.max(T, minVisual);
    const screenLen = lane.len * this.cam.scale;
    const count = Math.max(1, Math.min(Math.round(screenLen / 2.2), 220, Math.round(rs.caravans * visualT / T)));
    let ph;
    if (visualT === T) ph = rs.progress;
    else { ph = this.phase[def.id] = ((this.phase[def.id] || 0) + dt / visualT) % 1; }
    // Busy lanes spread sideways into a crowd instead of a single file.
    const spread = Math.min(16, Math.max(0, (count - 12) / 9)) / this.cam.scale;
    const off = (4 / this.cam.scale) + spread * 0.3;
    const r = count > 80 ? 2.3 : count > 20 ? 3 : 4;
    for (let dir = 0; dir < 2; dir++) {
      ctx.fillStyle = dir ? hexA(def.color, 0.45) : def.color;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1;
      for (let i = 0; i < count; i++) {
        const h1 = hash(i * 2 + dir), h2 = hash(i * 7 + 3 + dir);
        let p = (ph + (i + (count > 12 ? h1 * 0.9 : 0)) / count) % 1;
        if (dir) p = 1 - p;
        const side = (dir ? -off : off) + (h2 - 0.5) * spread;
        const [x, y] = this.toScreen(...lane.at(p, side));
        ctx.beginPath(); ctx.arc(x, y, dir ? r * 0.8 : r, 0, Math.PI * 2); ctx.fill(); if (!dir && count < 80) ctx.stroke();
      }
    }
    if (count <= 6) { // keep a camel leading a small caravan so early automation still reads as camels
      const [x, y] = this.toScreen(...lane.at(ph % 1, off));
      ctx.font = '16px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('🐫', x, y - 9); ctx.textBaseline = 'alphabetic';
    }
  }
}

// Precompute an evenly spaced polyline for a curved lane, with lookup by fraction and side offset.
function buildLane(content, def) {
  const a = content.towns[def.from], b = content.towns[def.to];
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, dx = b.x - a.x, dy = b.y - a.y;
  const cx = mx - dy * (def.bend || 0), cy = my + dx * (def.bend || 0);
  const raw = [];
  for (let i = 0; i <= 200; i++) {
    const t = i / 200, u = 1 - t;
    raw.push([u * u * a.x + 2 * u * t * cx + t * t * b.x, u * u * a.y + 2 * u * t * cy + t * t * b.y]);
  }
  const cum = [0];
  for (let i = 1; i < raw.length; i++) cum.push(cum[i - 1] + Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]));
  const len = cum[cum.length - 1], N = 60, pts = [];
  let j = 0;
  for (let i = 0; i <= N; i++) {
    const d = len * i / N;
    while (j < cum.length - 2 && cum[j + 1] < d) j++;
    const f = (d - cum[j]) / ((cum[j + 1] - cum[j]) || 1);
    pts.push([raw[j][0] + (raw[j + 1][0] - raw[j][0]) * f, raw[j][1] + (raw[j + 1][1] - raw[j][1]) * f]);
  }
  return {
    pts, len,
    at(p, side) {
      const f = Math.min(Math.max(p, 0), 1) * N, i = Math.min(N - 1, Math.floor(f)), g = f - i;
      const p0 = pts[i], p1 = pts[i + 1];
      const x = p0[0] + (p1[0] - p0[0]) * g, y = p0[1] + (p1[1] - p0[1]) * g;
      if (!side) return [x, y];
      const tx = p1[0] - p0[0], ty = p1[1] - p0[1], l = Math.hypot(tx, ty) || 1;
      return [x - ty / l * side, y + tx / l * side];
    },
  };
}

function buildTexture(land) {
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const out = [];
  while (out.length < 120) {
    const x = rnd() * 1000, y = rnd() * 1000;
    if (inside(land, x, y)) out.push([x, y, 6 + rnd() * 8]);
  }
  return out;
}

function inside(poly, x, y) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}

function smoothPoly(ctx, pts) {
  const n = pts.length, mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  let m = mid(pts[n - 1], pts[0]);
  ctx.moveTo(m[0], m[1]);
  for (let i = 0; i < n; i++) { const q = mid(pts[i], pts[(i + 1) % n]); ctx.quadraticCurveTo(pts[i][0], pts[i][1], q[0], q[1]); }
  ctx.closePath();
}

function hash(n) { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}
