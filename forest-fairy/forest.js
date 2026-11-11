'use strict';

const forest = document.querySelector('#forest');
const fairy = document.querySelector('#fairy');
const canvas = document.querySelector('#lights');
const ctx = canvas.getContext('2d');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const image = document.querySelector('.landscape');
image.addEventListener('error', () => { document.querySelector('.image-error').hidden = false; });
let width = 0, height = 0;
let target = { x: 0, y: 0 }, position = { x: 0, y: 0 };
let visible = false, previousTime = 0, frameId = 0, emission = 0;
let lightStrength = 0;
const particles = [];
const MAX_PARTICLES = 650;
const motes = Array.from({ length: 30 }, () => ({
  x: Math.random(), y: Math.random(), phase: Math.random() * Math.PI * 2,
  radius: .6 + Math.random() * 1.1, speed: .3 + Math.random() * .5
}));

function resize() {
  width = forest.clientWidth;
  height = forest.clientHeight;
  const ratio = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  target.x = Math.min(Math.max(target.x, 0), width);
  target.y = Math.min(Math.max(target.y, 0), height);
  position.x = Math.min(Math.max(position.x, 0), width);
  position.y = Math.min(Math.max(position.y, 0), height);
}

function move(event) {
  if (event.pointerType === 'touch') event.preventDefault();
  const rect = forest.getBoundingClientRect();
  target.x = event.clientX - rect.left;
  target.y = event.clientY - rect.top;
  if (!visible) {
    position = { ...target };
    visible = true;
    forest.classList.add('awake');
  }
}

function leave() {
  visible = false;
  forest.classList.remove('awake');
}

function addParticle(x, y) {
  const angle = Math.random() * Math.PI * 2;
  const life = 1.6 + Math.random() * 1.4;
  particles.push({ x: x + (Math.random() - .5) * 10, y: y + (Math.random() - .5) * 10,
    vx: Math.cos(angle) * (4 + Math.random() * 10), vy: 7 + Math.random() * 15,
    size: .8 + Math.random() * 1.7, life, total: life, phase: Math.random() * 6.28 });
  if (particles.length > MAX_PARTICLES) particles.shift();
}

// One reusable light texture keeps hundreds of trail sparks inexpensive to draw.
const glow = document.createElement('canvas');
glow.width = glow.height = 48;
const glowCtx = glow.getContext('2d');
const gradient = glowCtx.createRadialGradient(24, 24, 0, 24, 24, 24);
gradient.addColorStop(0, '#ffffee');
gradient.addColorStop(.12, '#fff5b8');
gradient.addColorStop(.3, '#eddb6d90');
gradient.addColorStop(1, '#d4ed7100');
glowCtx.fillStyle = gradient;
glowCtx.fillRect(0, 0, 48, 48);

function draw(time) {
  const dt = previousTime ? Math.min((time - previousTime) / 1000, .05) : 1 / 60;
  previousTime = time;
  ctx.clearRect(0, 0, width, height);
  // Keep the forest dark; the fairy gently opens a pool of light around itself.
  lightStrength += ((visible ? 1 : 0) - lightStrength) * (1 - Math.exp(-6 * dt));
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  const darkness = .84;
  const radius = Math.max(190, Math.min(width, height) * .42);
  const shade = ctx.createRadialGradient(position.x, position.y, 0, position.x, position.y, radius);
  shade.addColorStop(0, `rgba(2, 12, 8, ${darkness - .78 * lightStrength})`);
  shade.addColorStop(.35, `rgba(2, 12, 8, ${darkness - .65 * lightStrength})`);
  shade.addColorStop(.7, `rgba(2, 12, 8, ${darkness - .28 * lightStrength})`);
  shade.addColorStop(1, `rgba(2, 12, 8, ${darkness})`);
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, width, height);
  ctx.globalCompositeOperation = 'lighter';
  if (!reducedMotion) {
    for (const mote of motes) {
      const t = time / 1000;
      const x = mote.x * width + Math.sin(t * .15 + mote.phase) * 16;
      const y = ((mote.y * height - t * mote.speed * 3) % height + height) % height;
      ctx.globalAlpha = .15 + (Math.sin(t * mote.speed + mote.phase) + 1) * .12;
      const size = mote.radius * 8;
      ctx.drawImage(glow, x - size / 2, y - size / 2, size, size);
    }
  }

  if (visible) {
    const lastX = position.x, lastY = position.y;
    const follow = reducedMotion ? 1 : 1 - Math.exp(-13 * dt);
    position.x += (target.x - position.x) * follow;
    position.y += (target.y - position.y) * follow;
    const dx = position.x - lastX, dy = position.y - lastY;
    const distance = Math.hypot(dx, dy);
    fairy.style.transform = `translate3d(${position.x}px, ${position.y}px, 0) rotate(${Math.max(-15, Math.min(15, dx * 1.6))}deg)`;
    if (distance > .35) {
      emission += Math.min(distance / (reducedMotion ? 12 : 3), 35);
      const count = Math.floor(emission);
      emission -= count;
      for (let i = 0; i < count; i++) {
        const progress = (i + 1) / count;
        addParticle(lastX + dx * progress, lastY + dy * progress + 16);
      }
    }
    // The moving pool of light connects the fairy to the forest floor.
    ctx.globalAlpha = .12;
    ctx.drawImage(glow, position.x - 100, position.y - 100, 200, 200);
  }

  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    const fade = p.life / p.total;
    ctx.globalAlpha = fade * Math.min(1, (p.total - p.life) * 12) * .8;
    const size = p.size * 11;
    ctx.drawImage(glow, p.x - size / 2, p.y - size / 2, size, size);
    if (p.size > 1.9) {
      ctx.globalAlpha *= .65;
      ctx.fillStyle = '#fff6c4';
      const ray = (1.5 + Math.sin(time / 240 + p.phase)) * fade;
      ctx.fillRect(p.x - ray, p.y - .45, ray * 2, .9);
      ctx.fillRect(p.x - .45, p.y - ray, .9, ray * 2);
    }
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  frameId = requestAnimationFrame(draw);
}

forest.addEventListener('pointermove', move, { passive: false });
forest.addEventListener('pointerdown', move, { passive: false });
forest.addEventListener('pointerleave', leave);
forest.addEventListener('pointercancel', leave);
forest.addEventListener('pointerup', event => { if (event.pointerType === 'touch') leave(); });
window.addEventListener('blur', leave);
window.addEventListener('resize', resize);
document.addEventListener('visibilitychange', () => {
  cancelAnimationFrame(frameId);
  previousTime = 0;
  if (document.hidden) { leave(); particles.length = 0; }
  else frameId = requestAnimationFrame(draw);
});
resize();
frameId = requestAnimationFrame(draw);
