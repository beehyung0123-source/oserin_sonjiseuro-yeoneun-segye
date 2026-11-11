'use strict';

const forest = document.querySelector('#forest');
const fairy = document.querySelector('#fairy');
const canvas = document.querySelector('#lights');
const ctx = canvas.getContext('2d');
const message = document.querySelector('#message');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
document.querySelector('.landscape').addEventListener('error', () => {
  document.querySelector('.image-error').hidden = false;
});

let width = 0, height = 0, previousTime = 0, frameId = 0;
let pointer = null, position = { x: 0, y: 0 };
let summoned = false, lightStrength = 0, lastCheck = 0, burst = null;
let drawing = false, activePointer = null, lastMotionAt = 0, lastOrbitAt = 0, orbit = null;
const PAUSE_LIMIT = 450;
const DRAW_MESSAGE = '왼쪽 버튼을 누른 채 원을 계속 그리면 요정이 머물러요.';
let stroke = [];
const sparks = [];

// Check recent closed paths, including a circle drawn after an approach stroke.
function findCircle(points) {
  for (let start = points.length - 18; start >= 0; start -= 2) {
    let path = points.slice(start);
    // Smooth small hand tremors without requiring a perfectly drawn circle.
    for (let pass = 0; pass < 2; pass++) {
      path = path.map((p, i) => i === 0 || i === path.length - 1 ? p : ({
        x: (path[i - 1].x + p.x * 2 + path[i + 1].x) / 4,
        y: (path[i - 1].y + p.y * 2 + path[i + 1].y) / 4
      }));
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of path) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    const w = maxX - minX, h = maxY - minY;
    if (Math.min(w, h) < 64 || w / h < .62 || w / h > 1.62) continue;
    const center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
    const radius = (w + h) / 4;
    const first = path[0], last = path[path.length - 1];
    const closing = Math.hypot(last.x - first.x, last.y - first.y);
    if (closing > radius * .48) continue;
    let length = 0, area = 0, winding = 0, turning = 0, radiusError = 0;
    for (let i = 0; i < path.length; i++) {
      const a = path[i], b = path[(i + 1) % path.length];
      const distance = Math.hypot(a.x - center.x, a.y - center.y);
      radiusError += ((distance - radius) / radius) ** 2;
      length += Math.hypot(b.x - a.x, b.y - a.y);
      area += a.x * b.y - b.x * a.y;
      if (i < path.length - 1) {
        const angle = Math.atan2(a.y - center.y, a.x - center.x);
        const next = Math.atan2(b.y - center.y, b.x - center.x);
        const delta = Math.atan2(Math.sin(next - angle), Math.cos(next - angle));
        winding += delta;
        turning += Math.abs(delta);
      }
    }
    const compactness = 2 * Math.PI * Math.abs(area) / (length * length);
    if (Math.abs(winding) >= 5.65 && Math.abs(winding) <= 7.3 &&
        Math.abs(winding) / Math.max(turning, .001) > .84 &&
        Math.sqrt(radiusError / path.length) < .26 && compactness > .85) {
      return { ...center, radius, direction: Math.sign(winding) };
    }
  }
  return null;
}

function addSpark(x, y, speed = 1) {
  const angle = Math.random() * Math.PI * 2;
  const life = .65 + Math.random() * .9;
  sparks.push({ x, y, vx: Math.cos(angle) * (10 + Math.random() * 35) * speed,
    vy: (Math.sin(angle) * 22 - 18) * speed, life, total: life,
    size: .7 + Math.random() * 1.7 });
  if (sparks.length > 700) sparks.shift();
}

function summon(circle, time) {
  summoned = true;
  position = { x: circle.x, y: circle.y };
  burst = { ...circle, time };
  stroke = [];
  lastOrbitAt = time;
  orbit = { ...circle, angle: Math.atan2(pointer.y - circle.y, pointer.x - circle.x), travel: 0, progress: 0 };
  forest.classList.add('awake');
  message.textContent = '계속 원을 그려 요정을 불러주세요. 멈추면 요정은 사라져요.';
  for (let i = 0; i < 90; i++) {
    const angle = Math.random() * Math.PI * 2;
    addSpark(circle.x + Math.cos(angle) * circle.radius,
      circle.y + Math.sin(angle) * circle.radius, 1.7);
  }
}

function dismissFairy() {
  summoned = false;
  orbit = null;
  burst = null;
  stroke = [];
  forest.classList.remove('awake');
  message.textContent = DRAW_MESSAGE;
}

function continueCircle(point) {
  const angle = Math.atan2(point.y - orbit.y, point.x - orbit.x);
  const delta = Math.atan2(Math.sin(angle - orbit.angle), Math.cos(angle - orbit.angle));
  orbit.angle = angle;
  const radius = Math.hypot(point.x - orbit.x, point.y - orbit.y);
  if (radius < orbit.radius * .55 || radius > orbit.radius * 1.5 || Math.abs(delta) > 1) return;
  orbit.travel += delta * orbit.direction;
  // Only new progress around the circle sustains the fairy, not back-and-forth jitter.
  if (orbit.travel > orbit.progress + .025) {
    orbit.progress = orbit.travel;
    lastOrbitAt = point.t;
  }
}

function move(event) {
  if (!drawing || event.pointerId !== activePointer) return;
  if (!(event.buttons & 1) || event.target.closest('.camera-panel')) { stopDrawing(); return; }
  event.preventDefault();
  const rect = forest.getBoundingClientRect();
  const point = { x: event.clientX - rect.left, y: event.clientY - rect.top, t: performance.now() };
  if (point.x < 0 || point.x > width || point.y < 0 || point.y > height) { stopDrawing(); return; }
  if (point.t - lastMotionAt > PAUSE_LIMIT) { dismissFairy(); pointer = null; }
  if (pointer && Math.hypot(point.x - pointer.x, point.y - pointer.y) < 1.5) return;
  lastMotionAt = point.t;
  if (pointer) {
    const distance = Math.hypot(point.x - pointer.x, point.y - pointer.y);
    const count = Math.min(35, Math.ceil(distance / (reducedMotion ? 9 : 4)));
    for (let i = 1; i <= count; i++) {
      addSpark(pointer.x + (point.x - pointer.x) * i / count,
        pointer.y + (point.y - pointer.y) * i / count);
    }
  } else addSpark(point.x, point.y);
  pointer = point;
  if (summoned) { continueCircle(point); return; }
  const last = stroke[stroke.length - 1];
  if (last && Math.hypot(last.x - point.x, last.y - point.y) < 4) return;
  stroke.push(point);
  while (stroke.length && (point.t - stroke[0].t > 6500 || stroke.length > 360)) stroke.shift();
  if (point.t - lastCheck < 60) return;
  lastCheck = point.t;
  const circle = findCircle(stroke);
  if (circle) summon(circle, point.t);
}

function stopDrawing() {
  const captured = activePointer;
  drawing = false;
  activePointer = null;
  pointer = null;
  dismissFairy();
  if (captured !== null && forest.hasPointerCapture(captured)) forest.releasePointerCapture(captured);
}

function startDrawing(event) {
  if (event.button !== 0 || event.isPrimary === false || event.target.closest('button, .camera-panel')) return;
  event.preventDefault();
  stopDrawing();
  drawing = true;
  activePointer = event.pointerId;
  lastMotionAt = performance.now();
  forest.setPointerCapture(event.pointerId);
  move(event);
}

function resize() {
  width = forest.clientWidth;
  height = forest.clientHeight;
  const ratio = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  position.x = Math.max(0, Math.min(position.x, width));
  position.y = Math.max(0, Math.min(position.y, height));
  stopDrawing();
}

const glow = document.createElement('canvas');
glow.width = glow.height = 48;
const glowCtx = glow.getContext('2d');
const gradient = glowCtx.createRadialGradient(24, 24, 0, 24, 24, 24);
gradient.addColorStop(0, '#fffde1');
gradient.addColorStop(.12, '#ffdc84');
gradient.addColorStop(.35, '#ff8d3280');
gradient.addColorStop(1, '#ff6d1800');
glowCtx.fillStyle = gradient;
glowCtx.fillRect(0, 0, 48, 48);

function draw(time) {
  const dt = previousTime ? Math.min((time - previousTime) / 1000, .05) : 1 / 60;
  previousTime = time;
  if (summoned && (!drawing || time - lastMotionAt > PAUSE_LIMIT || time - lastOrbitAt > PAUSE_LIMIT)) dismissFairy();
  if (drawing && time - lastMotionAt > PAUSE_LIMIT) stroke = [];
  if (typeof drawFace === 'function') drawFace();
  if (summoned) {
    const lastX = position.x;
    if (pointer) {
      const follow = reducedMotion ? 1 : 1 - Math.exp(-9 * dt);
      position.x += (pointer.x - position.x) * follow;
      position.y += (pointer.y - position.y) * follow;
    }
    fairy.style.transform = `translate3d(${position.x}px, ${position.y}px, 0) rotate(${Math.max(-12, Math.min(12, (position.x - lastX) * 1.4))}deg)`;
  }
  lightStrength += ((summoned ? 1 : 0) - lightStrength) * (1 - Math.exp(-(summoned ? 4 : 9) * dt));
  ctx.clearRect(0, 0, width, height);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  const radius = Math.max(190, Math.min(width, height) * .43);
  const shade = ctx.createRadialGradient(position.x, position.y, 0, position.x, position.y, radius);
  shade.addColorStop(0, `rgba(0, 3, 2, ${.985 - .90 * lightStrength})`);
  shade.addColorStop(.4, `rgba(0, 3, 2, ${.985 - .70 * lightStrength})`);
  shade.addColorStop(.75, `rgba(0, 3, 2, ${.985 - .22 * lightStrength})`);
  shade.addColorStop(1, 'rgba(0, 3, 2, .985)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, width, height);
  ctx.globalCompositeOperation = 'lighter';

  // A faint, slowly fading line makes the drawn circle legible in the darkness.
  if (!summoned && stroke.length > 1) {
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = '#f8ae51';
    for (let i = 1; i < stroke.length; i++) {
      const age = (time - stroke[i].t) / 2200;
      if (age >= 1) continue;
      ctx.globalAlpha = (1 - age) * .45;
      ctx.beginPath(); ctx.moveTo(stroke[i - 1].x, stroke[i - 1].y);
      ctx.lineTo(stroke[i].x, stroke[i].y); ctx.stroke();
    }
  }
  for (let i = sparks.length - 1; i >= 0; i--) {
    const p = sparks[i];
    p.life -= dt;
    if (p.life <= 0) { sparks.splice(i, 1); continue; }
    p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 28 * dt;
    const fade = p.life / p.total;
    ctx.globalAlpha = fade * .9;
    const size = p.size * 10;
    ctx.drawImage(glow, p.x - size / 2, p.y - size / 2, size, size);
    ctx.globalAlpha = fade;
    ctx.fillStyle = '#ffedb5';
    ctx.fillRect(p.x, p.y, p.size * .7, p.size * .7);
  }
  if (drawing && pointer) {
    ctx.globalAlpha = .6;
    ctx.drawImage(glow, pointer.x - 17, pointer.y - 17, 34, 34);
  }
  if (burst) {
    const age = (time - burst.time) / 1100;
    if (age >= 1) burst = null;
    else {
      ctx.globalAlpha = (1 - age) * .6;
      ctx.strokeStyle = '#fff1b6'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(burst.x, burst.y, burst.radius * (1 + age * .35), 0, Math.PI * 2); ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  frameId = requestAnimationFrame(draw);
}

forest.addEventListener('pointermove', move, { passive: false });
forest.addEventListener('pointerdown', startDrawing, { passive: false });
forest.addEventListener('pointerleave', stopDrawing);
forest.addEventListener('pointercancel', stopDrawing);
forest.addEventListener('lostpointercapture', event => { if (event.pointerId === activePointer) stopDrawing(); });
window.addEventListener('pointerup', event => { if (event.pointerId === activePointer) stopDrawing(); });
window.addEventListener('blur', stopDrawing);
window.addEventListener('resize', resize);
document.addEventListener('visibilitychange', () => {
  cancelAnimationFrame(frameId); previousTime = 0; stopDrawing();
  if (document.hidden) sparks.length = 0;
  else frameId = requestAnimationFrame(draw);
});
resize();
frameId = requestAnimationFrame(draw);
