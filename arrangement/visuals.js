(() => {
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const segments = 16;
  const panels = tracks.map(track => {
    const canvas = track.card.querySelector('.stem-visual');
    return {
      track, pen: canvas.getContext('2d'),
      color: getComputedStyle(track.card).getPropertyValue('--accent').trim(),
      samples: new Float32Array(512),
      level: 0,
    };
  }).filter(panel => panel.pen);

  let frame = null;
  let lastDraw = -Infinity;

  function draw(panel) {
    const { track, pen, samples, color } = panel;
    let power = 0;
    if (track.enabled && track.volume > 0 && context?.state === 'running') {
      track.analyser.getFloatTimeDomainData(samples);
      for (const sample of samples) power += sample * sample;
    }
    const rms = Math.sqrt(power / samples.length);
    const level = 1 - Math.exp(-11 * rms);
    panel.level += (level - panel.level) * (level > panel.level ? 0.78 : 0.24);
    const lit = Math.round(panel.level * segments);
    const { width, height } = pen.canvas;
    const step = height / segments;
    pen.clearRect(0, 0, width, height);
    for (let index = 0; index < segments; index++) {
      pen.fillStyle = index < lit ? (index >= 13 ? '#ff9fcd' : color) : '#263133';
      pen.fillRect(2, height - (index + 1) * step + 2, width - 4, step - 3);
    }
  }

  function render(timestamp) {
    frame = null;
    if (mixer.hidden || document.hidden) return;
    if (timestamp - lastDraw >= (reducedMotion.matches ? 125 : 1000 / 30)) {
      lastDraw = timestamp;
      mixer.classList.toggle('is-playing', context?.state === 'running');
      panels.forEach(draw);
    }
    frame = requestAnimationFrame(render);
  }

  function syncVisibility() {
    if (mixer.hidden || document.hidden) {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      mixer.classList.remove('is-playing');
      panels.forEach(panel => { panel.level = 0; });
    } else if (frame === null) {
      lastDraw = -Infinity;
      frame = requestAnimationFrame(render);
    }
  }

  new MutationObserver(syncVisibility).observe(mixer, { attributes: true, attributeFilter: ['hidden'] });
  document.addEventListener('visibilitychange', syncVisibility);
  syncVisibility();
})();
