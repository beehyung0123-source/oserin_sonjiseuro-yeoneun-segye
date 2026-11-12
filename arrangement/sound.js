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
const openScreen = document.querySelector('#open-screen');
const trackList = document.querySelector('.tracks');
const template = document.querySelector('#track-template');

let context;
let buffers;
let phase = 'waiting';
let screenChannel;
let analyser;
let master;
let endsAt;
let sessionTimer;
const resultSeconds = 5;
const screenFadeSeconds = 2;
const audioFadeSeconds = 0.18;
const audioSamples = new Float32Array(512);

function publishMix() {
  screenChannel?.postMessage({
    type: 'mix',
    phase,
    volumes: Object.fromEntries(tracks.map(track => [track.id, track.enabled ? track.volume : 0])),
    returnAt: phase === 'result' ? Date.now() + (endsAt - context.currentTime) * 1000 : null,
    fadeDuration: screenFadeSeconds * 1000,
  });
}

function publishPulse() {
  analyser.getFloatTimeDomainData(audioSamples);
  let energy = 0;
  for (const sample of audioSamples) energy += sample * sample;
  const pulse = Math.min(1, Math.sqrt(energy / audioSamples.length) * 3);
  screenChannel.postMessage({ type: 'pulse', pulse });
}

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
    publishMix();
  });
  track.slider.addEventListener('input', () => {
    track.volume = track.slider.valueAsNumber;
    updateTrack(track);
    publishMix();
  });
  trackList.append(card);
}

function updateTrack(track, when = context.currentTime) {
  const level = track.enabled ? track.volume / 100 : 0;
  // Change only the volume. A muted stem keeps playing on the shared clock.
  track.gain.gain.cancelScheduledValues(when);
  track.gain.gain.setTargetAtTime(level, when, 0.012);

  track.card.classList.toggle('is-on', track.enabled);
  track.toggle.disabled = phase !== 'mixing';
  track.toggle.setAttribute('aria-pressed', String(track.enabled));
  track.state.textContent = track.enabled ? 'ON' : 'OFF';
  track.slider.disabled = phase !== 'mixing' || !track.enabled;
  track.slider.value = track.volume;
  track.amount.textContent = `${track.volume}%`;
}

async function loadBuffer(track) {
  const response = await fetch(`./음악/${track.id}.wav`);
  if (!response.ok) throw new Error(`${track.name} 음원 요청 실패 (${response.status})`);
  return context.decodeAudioData(await response.arrayBuffer());
}

async function start(withOriginalMix = false) {
  enter.disabled = true;
  waitingOriginal.disabled = true;
  waitingStatus.textContent = '음원을 불러오는 중입니다…';

  try {
    context ??= new AudioContext();
    await context.resume();
    buffers ??= await Promise.all(tracks.map(loadBuffer));
    if (buffers.some(buffer => buffer.length !== buffers[0].length)) {
      waitingStatus.textContent = '네 음원의 길이가 같아야 함께 반복할 수 있습니다.';
      return;
    }

    if (!master) {
      master = context.createGain();
      analyser = context.createAnalyser();
      analyser.fftSize = audioSamples.length;
      master.connect(analyser).connect(context.destination);
    }

    tracks.forEach((track, index) => {
      track.source = context.createBufferSource();
      track.source.buffer = buffers[index];
      track.source.loop = true;
      track.gain = context.createGain();
      track.gain.gain.value = 0;
      const { source, gain } = track;
      source.connect(gain).connect(master);
      source.onended = () => {
        source.disconnect();
        gain.disconnect();
      };
    });

    const startTime = context.currentTime + 0.06;
    phase = 'mixing';
    for (const track of tracks) {
      track.enabled = withOriginalMix;
      track.source.start(startTime);
      updateTrack(track);
    }

    master.gain.setValueAtTime(1, context.currentTime);
    scheduleEnd(startTime + buffers[0].duration * 2);
    waiting.hidden = true;
    mixer.hidden = false;
    original.focus();
    updateSession();
    publishMix();
    sessionTimer = setInterval(updateSession, 100);
  } catch (error) {
    console.error(error);
    waitingStatus.textContent = '음원을 열지 못했습니다. 다시 시도해 주세요.';
  } finally {
    enter.disabled = false;
    waitingOriginal.disabled = false;
  }
}

function scheduleEnd(time) {
  endsAt = time;
  const audioEnd = endsAt - resultSeconds;
  const fadeAt = Math.max(context.currentTime, audioEnd - audioFadeSeconds);
  master.gain.cancelScheduledValues(fadeAt);
  master.gain.setValueAtTime(1, fadeAt);
  master.gain.linearRampToValueAtTime(0, audioEnd);
  for (const track of tracks) track.source.stop(audioEnd);
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
  mixer.hidden = true;
  result.hidden = false;
  resultTitle.focus();
  publishMix();
}

function returnToWaiting() {
  phase = 'waiting';
  clearInterval(sessionTimer);
  for (const track of tracks) {
    track.enabled = false;
    track.volume = 100;
    updateTrack(track);
  }
  mixer.hidden = true;
  result.hidden = true;
  waitingStatus.textContent = '마우스로 소리를 조합해 보세요.';
  waiting.hidden = false;
  enter.focus();
  publishMix();
}

function updateSession() {
  if (phase === 'waiting') return;

  const left = endsAt - context.currentTime;
  if (left <= 0) {
    returnToWaiting();
  } else if (phase === 'mixing') {
    if (left <= resultSeconds) {
      showResult();
      return;
    }

    const seconds = Math.min(Math.ceil(left), Math.ceil(buffers[0].duration * 2));
    const label = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    if (remainingTime.textContent !== label) {
      remainingTime.textContent = label;
      remainingTime.dateTime = `PT${seconds}S`;
    }
    if (screenChannel) publishPulse();
  }
}

enter.addEventListener('click', () => start());
waitingOriginal.addEventListener('click', () => start(true));
finish.addEventListener('click', () => {
  if (phase !== 'mixing') return;
  const earlyEnd = context.currentTime + audioFadeSeconds + resultSeconds;
  if (earlyEnd < endsAt) scheduleEnd(earlyEnd);
});
document.addEventListener('visibilitychange', updateSession);

original.addEventListener('click', () => {
  const now = context.currentTime;
  for (const track of tracks) {
    track.enabled = true;
    track.volume = 100;
    updateTrack(track, now);
  }
  publishMix();
});

if (location.protocol === 'file:') {
  enter.disabled = true;
  waitingOriginal.disabled = true;
  openScreen.hidden = true;
  waitingStatus.textContent = 'arrangement 폴더의 play-sound.cmd를 더블클릭해 열어 주세요.';
} else {
  const sessionKey = 'arrangement-screen-session';
  const session = sessionStorage.getItem(sessionKey) ?? crypto.randomUUID();
  sessionStorage.setItem(sessionKey, session);

  openScreen.target = `arrangement-screen-${session}`;
  const screenUrl = new URL(openScreen.href);
  screenUrl.searchParams.set('session', session);
  openScreen.href = screenUrl.href;
  openScreen.addEventListener('click', event => {
    if (window.open(openScreen.href, openScreen.target, 'popup,width=1100,height=650')) {
      event.preventDefault();
    }
  });

  screenChannel = new BroadcastChannel(openScreen.target);
  screenChannel.addEventListener('message', event => {
    if (event.data?.type === 'ready') publishMix();
  });
  window.addEventListener('pageshow', () => {
    updateSession();
    publishMix();
  });
  window.addEventListener('pagehide', () => {
    screenChannel.postMessage({ type: 'mix', phase: 'waiting', volumes: {} });
  });
}
