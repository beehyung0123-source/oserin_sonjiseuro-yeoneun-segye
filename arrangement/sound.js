const tracks = [
  { id: 'drum', name: 'Drums', suit: '♣︎' },
  { id: 'bass', name: 'Bass', suit: '♠︎' },
  { id: 'synth', name: 'Synth', suit: '♦︎' },
  { id: 'vocal', name: 'Vocal', suit: '♥︎' },
];

const status = document.querySelector('#status');
const play = document.querySelector('#play');
const original = document.querySelector('#original');
const trackList = document.querySelector('.tracks');
const template = document.querySelector('#track-template');

let context;
let buffers;
let playing = false;

for (const track of tracks) {
  const card = template.content.firstElementChild.cloneNode(true);
  card.dataset.track = track.id;
  card.querySelector('.suit').textContent = track.suit;
  card.querySelector('.name').textContent = track.name.toUpperCase();

  track.card = card;
  track.toggle = card.querySelector('.toggle');
  track.state = card.querySelector('.state');
  track.slider = card.querySelector('.volume');
  track.amount = card.querySelector('.amount');
  track.enabled = false;
  track.volume = 100;
  track.slider.setAttribute('aria-label', `${track.name} 볼륨`);

  track.toggle.addEventListener('click', () => {
    track.enabled = !track.enabled;
    updateTrack(track);
  });
  track.slider.addEventListener('input', () => {
    track.volume = track.slider.valueAsNumber;
    updateTrack(track);
  });
  trackList.append(card);
}

function updateTrack(track, when = context.currentTime) {
  const level = track.enabled ? track.volume / 100 : 0;
  // Change only the volume. A muted stem keeps playing on the shared clock.
  track.gain.gain.cancelScheduledValues(when);
  track.gain.gain.setTargetAtTime(level, when, 0.012);

  track.card.classList.toggle('is-on', track.enabled);
  track.toggle.disabled = !playing;
  track.toggle.setAttribute('aria-pressed', String(track.enabled));
  track.state.textContent = track.enabled ? 'ON' : 'OFF';
  track.slider.disabled = !track.enabled;
  track.slider.value = track.volume;
  track.amount.textContent = `${track.volume}%`;
}

async function loadBuffer(track) {
  const response = await fetch(`./음악/${track.id}.wav`);
  if (!response.ok) throw new Error(`${track.name} 음원 요청 실패 (${response.status})`);
  return context.decodeAudioData(await response.arrayBuffer());
}

async function start(withOriginalMix = false) {
  play.disabled = true;
  original.disabled = true;
  status.textContent = '음원을 불러오는 중입니다…';

  try {
    context ??= new AudioContext();
    await context.resume();
    buffers ??= await Promise.all(tracks.map(loadBuffer));
    if (buffers.some(buffer => buffer.length !== buffers[0].length)) {
      status.textContent = '네 음원의 길이가 같아야 함께 반복할 수 있습니다.';
      return;
    }

    tracks.forEach((track, index) => {
      track.source = context.createBufferSource();
      track.source.buffer = buffers[index];
      track.source.loop = true;
      track.gain = context.createGain();
      track.gain.gain.value = 0;
      track.source.connect(track.gain).connect(context.destination);
    });

    const startTime = context.currentTime + 0.06;
    playing = true;
    for (const track of tracks) {
      track.enabled = withOriginalMix;
      track.source.start(startTime);
      updateTrack(track);
    }

    play.textContent = '재생 정지';
    status.textContent = '문양을 눌러 소리를 켜고, 막대로 볼륨을 조절하세요.';
  } catch (error) {
    console.error(error);
    status.textContent = '음원을 열지 못했습니다. 다시 시도해 주세요.';
  } finally {
    play.disabled = false;
    original.disabled = false;
  }
}

function stop() {
  playing = false;
  const now = context.currentTime;
  for (const track of tracks) {
    track.enabled = false;
    track.volume = 100;
    updateTrack(track, now);

    const { source, gain } = track;
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
    };
    source.stop(now + 0.08);
  }

  play.textContent = '재생 시작';
  status.textContent = '재생을 시작한 뒤 문양을 눌러 소리를 켜세요.';
}

play.addEventListener('click', () => {
  if (playing) stop();
  else start();
});

original.addEventListener('click', () => {
  if (!playing) {
    start(true);
    return;
  }

  const now = context.currentTime;
  for (const track of tracks) {
    track.enabled = true;
    track.volume = 100;
    updateTrack(track, now);
  }
});

if (location.protocol === 'file:') {
  play.disabled = true;
  original.disabled = true;
  status.textContent = 'arrangement 폴더의 play-sound.cmd를 더블클릭해 열어 주세요.';
}
