const tracks = [
  { id: 'drum', name: 'Drums', suit: '♣︎' },
  { id: 'bass', name: 'Bass', suit: '♠︎' },
  { id: 'synth', name: 'Synth', suit: '♦︎' },
  { id: 'vocal', name: 'Vocal', suit: '♥︎' },
];

const waiting = document.querySelector('#waiting');
const mixer = document.querySelector('#mixer');
const result = document.querySelector('#result');
const resultTitle = document.querySelector('#result-title');
const resultTracks = document.querySelector('#result-tracks');
const resultEmpty = document.querySelector('#result-empty');
const resultTemplate = document.querySelector('#result-track-template');
const waitingStatus = document.querySelector('#waiting-status');
const enter = document.querySelector('#enter');
const waitingOriginal = document.querySelector('#waiting-original');
const finish = document.querySelector('#finish');
const original = document.querySelector('#original');
const remainingTime = document.querySelector('#remaining');
const trackList = document.querySelector('.tracks');
const template = document.querySelector('#track-template');

let context;
let buffers;
let phase = 'waiting';
let audioReady = false;
let activating;
let endsAt;
let sessionTimer;
let resultUntil;
let mixAnalyser;
let mixStartedAt;
let transportChanging = false;
const resultSeconds = 5;
const readyMessage = 'START나 원곡 듣기에 검지 커서를 올리고 엄지와 검지를 붙이세요.';

for (const [index, track] of tracks.entries()) {
  const card = template.content.firstElementChild.cloneNode(true);
  card.dataset.track = track.id;
  card.querySelector('.channel-number').textContent = `CH.${String(index + 1).padStart(2, '0')}`;
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
    toggleStem(track.id);
  });
  track.slider.addEventListener('input', () => {
    setStemVolume(track.id, track.slider.valueAsNumber);
  });
  trackList.append(card);
}

function toggleStem(id) {
  if (phase !== 'mixing') return;
  const track = tracks.find(track => track.id === id);
  if (!track) return;
  track.enabled = !track.enabled;
  updateTrack(track);
}

function setStemVolume(id, volume) {
  if (phase !== 'mixing' || !Number.isFinite(volume)) return;
  const track = tracks.find(track => track.id === id);
  const nextVolume = Math.round(Math.min(100, Math.max(0, volume)));
  if (!track || track.volume === nextVolume) return;
  track.volume = nextVolume;
  updateTrack(track);
}

function updateTrack(track, when = context.currentTime) {
  const level = track.enabled ? track.volume / 100 : 0;
  // Change only the volume. A muted stem keeps playing on the shared clock.
  track.gain.gain.cancelScheduledValues(when);
  track.gain.gain.setTargetAtTime(level, when, 0.012);

  track.card.classList.toggle('is-on', track.enabled);
  track.toggle.disabled = phase !== 'mixing';
  track.toggle.setAttribute('aria-pressed', String(track.enabled));
  track.state.textContent = track.enabled ? (track.volume === 0 ? 'ON · 0%' : 'ON') : 'OFF';
  track.slider.disabled = phase !== 'mixing' || !track.enabled;
  track.slider.value = track.volume;
  track.card.style.setProperty('--volume-percent', `${track.volume}%`);
  track.amount.textContent = `${track.volume}%`;
}

async function loadBuffer(track) {
  const response = await fetch(`./음악/${track.id}.wav`);
  if (!response.ok) throw new Error(`${track.name} 음원 요청 실패 (${response.status})`);
  return context.decodeAudioData(await response.arrayBuffer());
}

function canStartExperience() {
  return audioReady && context.state === 'running' && phase === 'waiting';
}

async function activateAudio() {
  if (activating) return;
  enter.disabled = true;
  waitingOriginal.disabled = true;
  waitingStatus.textContent = '음원을 불러오는 중입니다…';

  activating = (async () => {
    context ??= new AudioContext();
    // Called directly from a trusted keyboard or mouse event.
    await context.resume();
    if (context.state !== 'running') throw new Error('AudioContext: ' + context.state);
    if (!audioReady) {
      buffers ??= await Promise.all(tracks.map(loadBuffer));
      if (buffers.some(buffer => buffer.length !== buffers[0].length)) {
        throw new Error('네 음원의 길이가 같아야 함께 반복할 수 있습니다.');
      }
      const master = context.createGain();
      mixAnalyser = context.createAnalyser();
      mixAnalyser.fftSize = 512;
      master.connect(mixAnalyser).connect(context.destination);
      const startTime = context.currentTime + 0.06;
      mixStartedAt = startTime;
      tracks.forEach((track, index) => {
        track.source = context.createBufferSource();
        track.source.buffer = buffers[index];
        track.source.loop = true;
        track.gain = context.createGain();
        track.gain.gain.value = 0;
        track.analyser = context.createAnalyser();
        track.analyser.fftSize = 512;
        // Measure the audible stem after its gain, along its single output path.
        track.source.connect(track.gain).connect(track.analyser).connect(master);
        track.source.start(startTime);
      });
      audioReady = true;
    }
    waitingStatus.textContent = readyMessage;
    console.info('AudioContext:', context.state);
  })();

  try {
    await activating;
  } catch (error) {
    console.error(error);
    waitingStatus.textContent = '오디오를 시작하지 못했습니다. Space 또는 Enter로 다시 시도해 주세요.';
  } finally {
    activating = undefined;
    enter.disabled = false;
    waitingOriginal.disabled = false;
  }
}

function startExperience(withOriginalMix = false) {
  if (!canStartExperience()) return;
  phase = 'mixing';
  for (const track of tracks) {
    track.enabled = withOriginalMix;
    updateTrack(track);
  }
  endsAt = context.currentTime + buffers[0].duration * 2;
  waiting.hidden = true;
  mixer.hidden = false;
  updateSession();
  sessionTimer = setInterval(updateSession, 100);
}

function showResult() {
  phase = 'result';
  const audible = tracks.filter(track => track.enabled && track.volume > 0);
  resultTracks.replaceChildren(...audible.map(track => {
    const item = resultTemplate.content.firstElementChild.cloneNode(true);
    item.dataset.track = track.id;
    item.querySelector('.name').textContent = track.name.toUpperCase();
    item.querySelector('.amount').textContent = `${track.volume}%`;
    return item;
  }));
  resultTracks.hidden = audible.length === 0;
  resultEmpty.hidden = audible.length > 0;
  for (const track of tracks) {
    track.enabled = false;
    track.volume = 100;
    updateTrack(track);
  }
  resultUntil = performance.now() + resultSeconds * 1000;
  if (context.state === 'suspended') context.resume().catch(console.warn);
  mixer.hidden = true;
  result.hidden = false;
  resultTitle.focus();
}

function returnToWaiting() {
  phase = 'waiting';
  clearInterval(sessionTimer);
  mixer.hidden = true;
  result.hidden = true;
  waitingStatus.textContent = readyMessage;
  waiting.hidden = false;
}

function updateSession() {
  if (phase === 'waiting') return;
  if (phase === 'result') {
    if (performance.now() >= resultUntil) returnToWaiting();
    return;
  }

  const left = endsAt - context.currentTime;
  if (left <= 0) {
    showResult();
    return;
  }

  if (phase === 'mixing') {
    const seconds = Math.min(Math.ceil(left), Math.ceil(buffers[0].duration * 2));
    const label = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    if (remainingTime.textContent !== label) {
      remainingTime.textContent = label;
      remainingTime.dateTime = `PT${seconds}S`;
    }
  }
}

function finishExperience() {
  if (phase === 'mixing') showResult();
}

document.querySelector('#playback').addEventListener('click', async () => {
  if (phase !== 'mixing' || transportChanging) return;
  transportChanging = true;
  try {
    if (context.state === 'running') await context.suspend();
    else await context.resume();
    // A hand-triggered FINISH can occur while suspension is in flight.
    if (phase !== 'mixing' && context.state === 'suspended') await context.resume();
  } catch (error) {
    console.warn('재생 상태를 변경할 수 없습니다.', error);
  } finally {
    transportChanging = false;
  }
});

async function startFromClick(withOriginalMix) {
  if (!canStartExperience()) await activateAudio();
  startExperience(withOriginalMix);
}

enter.addEventListener('click', () => startFromClick(false));
waitingOriginal.addEventListener('click', () => startFromClick(true));
finish.addEventListener('click', finishExperience);

document.addEventListener('keydown', event => {
  if (!event.isTrusted || location.protocol === 'file:' || phase !== 'waiting' || canStartExperience()
      || event.repeat || !['Space', 'Enter'].includes(event.code)) return;
  event.preventDefault();
  activateAudio();
});
document.addEventListener('visibilitychange', updateSession);
window.addEventListener('pageshow', updateSession);

function playOriginalMix() {
  if (phase !== 'mixing') return;
  if (context.state === 'suspended') context.resume().catch(console.warn);
  const now = context.currentTime;
  for (const track of tracks) {
    track.enabled = true;
    track.volume = 100;
    updateTrack(track, now);
  }
}

original.addEventListener('click', playOriginalMix);

if (location.protocol === 'file:') {
  enter.disabled = true;
  waitingOriginal.disabled = true;
  waitingStatus.textContent = '웹 주소에서 앱을 열어 주세요.';
}
