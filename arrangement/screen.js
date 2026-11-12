const stage = document.querySelector('.screen-stage');
const ribbon = document.querySelector('.light-ribbon');
const suits = document.querySelector('.suits');
const fullscreen = document.querySelector('.screen-fullscreen');

// x and y are percentages. Smaller, softer copies sit farther back in the scene.
const placements = {
  drum: [[21, 57, 1, -9, 1, 0], [12, 21, 0.50, 13, 0.44, 2], [54, 16, 0.34, -12, 0.34, 4]],
  bass: [[39, 31, 0.87, 11, 0.92, 0], [77, 16, 0.49, -13, 0.54, 1.5], [12, 96, 1.25, -18, 0.50, 5]],
  synth: [[55, 59, 1.02, -7, 0.96, 0], [70, 39, 0.52, 18, 0.49, 1.5], [42, 95, 1.08, -11, 0.40, 4]],
  vocal: [[79, 69, 1.06, 10, 0.97, 0], [91, 34, 0.51, -17, 0.44, 2], [95, 100, 1.28, -6, 0.49, 6]],
};

const groups = Object.entries(placements).map(([stem, copies]) => {
  const group = document.createElement('div');
  group.className = 'suit-group';
  group.dataset.stem = stem;

  copies.forEach(([x, y, size, angle, alpha, blur], index) => {
    const suit = document.createElement('div');
    suit.className = 'glass-suit';
    suit.style.setProperty('--x', `${x}%`);
    suit.style.setProperty('--y', `${y}%`);
    suit.style.setProperty('--size', size);
    suit.style.setProperty('--angle', `${angle}deg`);
    suit.style.setProperty('--alpha', alpha);
    suit.style.setProperty('--blur', `${blur}px`);
    suit.style.setProperty('--duration', `${7 + index * 2}s`);
    suit.style.setProperty('--delay', `${-x / 12}s`);
    group.append(suit);
  });

  suits.append(group);
  return group;
});

function drawRibbon() {
  const pixelRatio = Math.min(window.devicePixelRatio, 2);
  ribbon.width = Math.round(ribbon.clientWidth * pixelRatio);
  ribbon.height = Math.round(ribbon.clientHeight * pixelRatio);
  const light = ribbon.getContext('2d');
  light.scale(ribbon.width / 1000, ribbon.height / 600);

  const crest = new Path2D();
  crest.moveTo(-50, 494);
  crest.bezierCurveTo(195, 260, 342, 337, 557, 359);
  crest.bezierCurveTo(747, 381, 850, 305, 1050, 175);

  const band = new Path2D(crest);
  band.bezierCurveTo(893, 357, 747, 449, 543, 375);
  band.bezierCurveTo(303, 288, 197, 348, -50, 575);
  band.closePath();

  const haze = light.createLinearGradient(0, 248, 0, 546);
  haze.addColorStop(0, '#d9e1ee46');
  haze.addColorStop(0.42, '#a8b4c041');
  haze.addColorStop(1, '#505b6a00');
  light.fillStyle = haze;
  light.shadowColor = '#c9d4e0';
  light.shadowBlur = 36 * pixelRatio;
  light.fill(band);

  const edge = light.createLinearGradient(0, 0, 1000, 0);
  edge.addColorStop(0, '#b8c3d379');
  edge.addColorStop(0.35, '#b8c3d336');
  edge.addColorStop(0.62, '#e7eef5aa');
  edge.addColorStop(1, '#c3d0e482');
  light.shadowBlur = 9 * pixelRatio;
  light.strokeStyle = edge;
  light.lineWidth = 1.35;
  light.stroke(crest);
}

function renderMix(volumes) {
  let hasSuits = false;
  for (const group of groups) {
    const volume = volumes[group.dataset.stem] ?? 0;
    group.classList.toggle('is-visible', volume > 0);
    group.style.setProperty('--volume-scale', volume / 100);
    hasSuits ||= volume > 0;
  }
  stage.classList.toggle('has-suits', hasSuits);
}

const session = new URLSearchParams(location.search).get('session');
if (session) {
  const channel = new BroadcastChannel(`arrangement-screen-${session}`);
  let fade;
  channel.addEventListener('message', ({ data }) => {
    if (data?.type === 'pulse') {
      stage.style.setProperty('--pulse-scale', 1 + data.pulse * 0.035);
    } else if (data?.type === 'mix') {
      fade?.cancel();
      const finishing = data.phase === 'result';
      const waiting = data.phase === 'waiting';
      stage.classList.toggle('is-finishing', finishing);
      stage.classList.toggle('is-waiting', waiting);
      renderMix(waiting ? {} : data.volumes);

      if (finishing) {
        const remaining = Math.max(0, data.returnAt - Date.now());
        const duration = Math.min(remaining, data.fadeDuration);
        fade = suits.animate([{ opacity: duration / data.fadeDuration }, { opacity: 0 }], {
          delay: remaining - duration,
          duration,
          fill: 'both',
        });
      }
    }
  });
  channel.postMessage({ type: 'ready' });
}

fullscreen.addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch (error) {
    console.error('전체 화면으로 전환할 수 없습니다.', error);
  }
});

document.addEventListener('fullscreenchange', () => {
  fullscreen.textContent = document.fullscreenElement ? '전체 화면 종료' : '전체 화면';
});

window.addEventListener('resize', drawRibbon);
drawRibbon();
