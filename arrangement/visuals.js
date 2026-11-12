(() => {
  const frameInterval = 1000 / 30;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const response = {
    drum: [0.8, 0.24],
    bass: [0.24, 0.13],
    synth: [0.15, 0.10],
    vocal: [0.52, 0.23],
  };

  const panels = tracks.map(track => {
    const canvas = track.card.querySelector('.stem-visual');
    return {
      track, canvas, pen: canvas.getContext('2d'),
      color: getComputedStyle(track.card).getPropertyValue('--accent').trim(),
      samples: new Float32Array(512),
      bars: new Float32Array(16),
      width: 0, height: 0, energy: 0,
    };
  }).filter(panel => panel.pen);

  const resize = new ResizeObserver(entries => {
    for (const { target, contentRect } of entries) {
      const panel = panels.find(panel => panel.canvas === target);
      const { width, height } = contentRect;
      const scale = Math.min(devicePixelRatio || 1, 1.5);
      panel.width = width;
      panel.height = height;
      target.width = Math.round(width * scale);
      target.height = Math.round(height * scale);
      panel.pen.setTransform(scale, 0, 0, scale, 0, 0);
    }
  });
  panels.forEach(panel => resize.observe(panel.canvas));

  function measure(panel) {
    const { track, samples } = panel;
    if (track.enabled && track.volume > 0) track.analyser.getFloatTimeDomainData(samples);
    else samples.fill(0);
    let power = 0;
    for (const sample of samples) power += sample * sample;
    const rms = Math.sqrt(power / samples.length);
    const target = 1 - Math.exp(-8 * rms);
    const [attack, release] = response[track.id];
    panel.energy += (target - panel.energy) * (target > panel.energy ? attack : release);
  }

  function drawDrums({ pen, width, height, energy, bars, samples }) {
    const step = width * 0.82 / bars.length;
    const windowSize = samples.length / bars.length;
    for (let i = 0; i < bars.length; i++) {
      let peak = 0;
      for (let j = i * windowSize; j < (i + 1) * windowSize; j++) {
        peak = Math.max(peak, Math.abs(samples[j]));
      }
      const target = (1 - Math.exp(-5 * peak)) * 0.65 + energy * 0.35;
      bars[i] += (target - bars[i]) * (target > bars[i] ? 0.86 : 0.27);
      const length = height * (0.065 + bars[i] * 0.75);
      pen.globalAlpha = 0.36 + bars[i] * 0.64;
      pen.fillRect(width * 0.09 + i * step, (height - length) / 2, step * 0.59, length);
    }
  }

  function drawBass({ pen, width, height, energy }) {
    const radius = Math.min(width, height) * (0.32 + energy * 0.15);
    for (let ring = 1; ring <= 4; ring++) {
      pen.beginPath();
      pen.globalAlpha = 0.19 + energy * 0.50 + (4 - ring) * 0.1;
      pen.arc(width / 2, height / 2, radius * ring / 4, 0, 2 * Math.PI);
      pen.stroke();
    }
  }

  function drawSynth({ pen, width, height, energy }) {
    for (let line = 0; line < 4; line++) {
      const center = height * (0.38 + line * 0.08);
      const lift = height * (0.04 + energy * (0.18 + line * 0.03));
      pen.beginPath();
      pen.globalAlpha = 0.27 + line * 0.12 + energy * 0.3;
      pen.moveTo(width * 0.08, center);
      pen.bezierCurveTo(width * 0.29, center - lift, width * 0.34, center - lift, width * 0.50, center);
      pen.bezierCurveTo(width * 0.67, center + lift, width * 0.71, center + lift, width * 0.92, center);
      pen.stroke();
    }
  }

  function drawVocal({ pen, width, height, energy, samples }) {
    pen.beginPath();
    pen.globalAlpha = 0.42 + energy * 0.58;
    for (let i = 0; i <= 64; i++) {
      const sample = samples[Math.round(i / 64 * (samples.length - 1))];
      const displacement = Math.max(-1, Math.min(1, sample * 3));
      const x = width * (0.08 + 0.84 * i / 64);
      const y = height * (0.5 - displacement * 0.44 * Math.sin(Math.PI * i / 64));
      if (i === 0) pen.moveTo(x, y);
      else pen.lineTo(x, y);
    }
    pen.stroke();
  }

  const draw = { drum: drawDrums, bass: drawBass, synth: drawSynth, vocal: drawVocal };
  let frame = null;
  let lastDraw = -Infinity;

  function render(timestamp) {
    frame = null;
    if (mixer.hidden || document.hidden) return;

    if (timestamp - lastDraw >= (reducedMotion.matches ? 125 : frameInterval)) {
      lastDraw = timestamp;
      for (const panel of panels) {
        if (!panel.width || !panel.height) continue;
        measure(panel);
        const { pen, width, height, color, track } = panel;
        pen.clearRect(0, 0, width, height);
        pen.fillStyle = color;
        pen.strokeStyle = color;
        pen.lineWidth = 1.7;
        pen.lineCap = 'round';
        draw[track.id](panel);
      }
    }
    frame = requestAnimationFrame(render);
  }

  function syncVisibility() {
    if (mixer.hidden || document.hidden) {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      for (const panel of panels) {
        panel.energy = 0;
        panel.bars.fill(0);
      }
    } else if (frame === null) {
      lastDraw = -Infinity;
      frame = requestAnimationFrame(render);
    }
  }

  new MutationObserver(syncVisibility).observe(mixer, { attributes: true, attributeFilter: ['hidden'] });
  document.addEventListener('visibilitychange', syncVisibility);
  syncVisibility();
})();
