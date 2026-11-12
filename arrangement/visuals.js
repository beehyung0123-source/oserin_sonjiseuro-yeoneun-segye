(() => {
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const transportState = mixer.querySelector('.play-state');
  const playbackButton = document.querySelector('#playback');
  const deck = mixer.querySelector('.deck-scene');
  const playbackTime = document.querySelector('#playback-time');
  const overview = mixer.querySelector('.signal-overview').getContext('2d');
  const waveform = mixer.querySelector('.signal-wave').getContext('2d');
  const spectrum = new Uint8Array(256);
  const mixSamples = new Float32Array(512);
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

  function draw(panel, playing) {
    const { track, pen, samples, color } = panel;
    let power = 0;
    if (playing && track.enabled && track.volume > 0) {
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
      pen.fillStyle = index < lit ? color : '#b9bfc2';
      pen.fillRect(2, height - (index + 1) * step + 2, width - 4, step - 3);
    }
  }

  function formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    const remainder = Math.floor(seconds % 60);
    return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
  }

  function drawMix(playing) {
    if (playing) {
      mixAnalyser.getByteFrequencyData(spectrum);
      mixAnalyser.getFloatTimeDomainData(mixSamples);
    } else {
      spectrum.fill(0);
      mixSamples.fill(0);
    }
    if (overview) {
      const { width, height } = overview.canvas;
      overview.clearRect(0, 0, width, height);
      overview.fillStyle = '#25292b';
      for (let index = 0; index < 48; index++) {
        const bar = 1 + spectrum[index * 2] / 255 * (height - 4);
        overview.fillRect(index * width / 48, height - bar, 2, bar);
      }
    }
    if (waveform) {
      const { width, height } = waveform.canvas;
      waveform.clearRect(0, 0, width, height);
      waveform.strokeStyle = '#25292b';
      waveform.beginPath();
      for (let index = 0; index < mixSamples.length; index += 2) {
        const x = index / (mixSamples.length - 2) * width;
        const y = height / 2 - Math.max(-1, Math.min(1, mixSamples[index] * 2)) * height * 0.46;
        if (index === 0) waveform.moveTo(x, y);
        else waveform.lineTo(x, y);
      }
      waveform.stroke();
    }
  }

  function render(timestamp) {
    frame = null;
    if (mixer.hidden || document.hidden) return;
    if (timestamp - lastDraw >= (reducedMotion.matches ? 125 : 1000 / 30)) {
      lastDraw = timestamp;
      const playing = isMixPlaying();
      const locked = context.state !== 'running';
      const needleDown = deck.dataset.state === 'needle-down';
      const position = getMixPosition();
      mixer.classList.toggle('is-playing', playing);
      let label = 'STOPPED';
      if (locked) label = 'Space / Enter로 오디오 켜기';
      else if (playing) label = 'NOW PLAYING';
      else if (needleDown) label = 'CUEING';
      else if (deck.dataset.state === 'needle-up') label = position > 0 ? 'PAUSED' : 'PLATTER SPINNING';
      if (transportState.textContent !== label) transportState.textContent = label;
      const action = locked ? '오디오 켜기' : 'LIFT';
      if (playbackButton.textContent !== action) playbackButton.textContent = action;
      playbackButton.disabled = !locked && !needleDown;
      const duration = buffers[0].duration;
      const timeLabel = `${formatTime(position)} / ${formatTime(duration)}`;
      if (playbackTime.textContent !== timeLabel) playbackTime.textContent = timeLabel;
      drawMix(playing);
      panels.forEach(panel => draw(panel, playing));
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
