// "Juice": sounds, vibration, floating numbers. Purely cosmetic, no game state here.
let ctx = null;
export const fxSettings = { sound: true, haptics: true };

function audio() {
  if (!fxSettings.sound) return null;
  if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; } }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(freq, start, dur, type = 'sine', vol = 0.15, slideTo = null) {
  const a = audio(); if (!a) return;
  const t = a.currentTime + start;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t); o.stop(t + dur + 0.02);
}

let combo = 0, lastTapAt = 0, lastCoinAt = 0;
export const sfx = {
  tap() {
    const now = performance.now();
    combo = now - lastTapAt < 450 ? Math.min(combo + 1, 16) : 0;
    lastTapAt = now;
    const f = 380 * Math.pow(2, combo / 24);
    tone(f, 0, 0.07, 'triangle', 0.12, f * 1.5);
  },
  coin(big = false) {
    const now = performance.now();
    if (now - lastCoinAt < 120) return; // fast routes would otherwise buzz
    lastCoinAt = now;
    tone(big ? 988 : 1319, 0, 0.08, 'square', 0.05);
    tone(big ? 1319 : 1760, 0.06, big ? 0.25 : 0.14, 'square', 0.05);
  },
  hire() { tone(520, 0, 0.12, 'triangle', 0.14, 900); tone(900, 0.07, 0.12, 'sine', 0.08); },
  unlock() { [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.07, 0.18, 'triangle', 0.13)); },
  milestone() { [523, 784, 1047, 1319, 1568].forEach((f, i) => tone(f, i * 0.06, 0.3, 'square', 0.06)); },
  deny() { tone(180, 0, 0.12, 'sawtooth', 0.06, 120); },
};

export function buzz(ms) {
  if (fxSettings.haptics && navigator.vibrate) navigator.vibrate(ms);
}

// Floating "+123" text that rises and fades from a point on screen.
export function floatText(x, y, text, cls = '') {
  const el = document.createElement('div');
  el.className = 'float ' + cls;
  el.textContent = text;
  el.style.left = x + 'px';
  el.style.top = y + 'px';
  el.style.setProperty('--dx', (Math.random() * 40 - 20) + 'px');
  document.body.appendChild(el);
  el.addEventListener('animationend', () => el.remove());
}

// A small burst of coin emoji from a point, used for arrivals and purchases.
export function burst(x, y, n = 6, glyph = '🪙') {
  for (let i = 0; i < n; i++) {
    const el = document.createElement('div');
    el.className = 'particle';
    el.textContent = glyph;
    const ang = Math.random() * Math.PI * 2, dist = 30 + Math.random() * 50;
    el.style.left = x + 'px'; el.style.top = y + 'px';
    el.style.setProperty('--tx', Math.cos(ang) * dist + 'px');
    el.style.setProperty('--ty', Math.sin(ang) * dist - 30 + 'px');
    document.body.appendChild(el);
    el.addEventListener('animationend', () => el.remove());
  }
}

// Restart a CSS animation class on an element.
export function pulse(el, cls) {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}
