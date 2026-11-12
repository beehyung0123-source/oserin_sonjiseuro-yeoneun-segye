const visionPackage = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21';
const modelUrl = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const indexTip = 8;
const thumbTip = 4;
const pinchStartRatio = 0.25;
const pinchReleaseRatio = 0.40;
const pinchConfirmationFrames = 3;
const smoothingMs = 75;
const selectionDwellMs = 250;
const trackingGraceMs = 300;
const shortPinchMs = 350;
const dragThresholdPx = 25;
const finishDwellMs = 1500;
const volumeTravel = 0.4; // Fraction of the screen height for a 0–100% adjustment.
const cursor = document.querySelector('.hand-cursor');
const mixer = document.querySelector('#mixer');
const startButton = document.querySelector('#enter');
const finishButton = document.querySelector('#finish');
const handReady = document.querySelector('#hand-ready');
// Keep the video off the DOM so the TV only shows the cursor.
const video = document.createElement('video');
video.muted = true;
video.playsInline = true;

const clamp = value => Math.min(1, Math.max(0, value));
let session;
let selectedCard;
let grabbedCard;
let volumeDrag;
let dwellTarget;
let dwellSince;

function updateDwell(target, timestamp) {
  if (target !== dwellTarget) {
    dwellTarget?.style.removeProperty('--dwell-progress');
    dwellTarget = target;
    dwellSince = timestamp;
  }
  if (!target) return;
  const progress = (timestamp - dwellSince) / finishDwellMs;
  target.style.setProperty('--dwell-progress', `${Math.min(progress, 1) * 100}%`);
  if (progress < 1) return;
  updateDwell(null);
  finishExperience();
}

function grabCard(card, startY, palm, timestamp) {
  if (grabbedCard === card) return;
  if (grabbedCard) {
    grabbedCard.classList.remove('is-hand-grabbed');
    grabbedCard.querySelector('.grab-status').hidden = true;
  }
  grabbedCard = card;
  volumeDrag = undefined;
  cursor.classList.toggle('is-grabbing', Boolean(card));
  if (card) {
    selectCard(card);
    card.classList.add('is-hand-grabbed');
    const status = card.querySelector('.grab-status');
    status.textContent = 'GRABBED';
    status.hidden = false;
    const slider = card.querySelector('.volume');
    const startVolume = slider.valueAsNumber;
    volumeDrag = {
      stemId: card.dataset.track, slider, startY, startVolume, lastVolume: startVolume,
      palm, startedAt: timestamp, dragging: false, interrupted: false,
    };
  }
}

function adjustGrabbedVolume(currentY) {
  const { stemId, slider, startY, startVolume, lastVolume } = volumeDrag;
  if (slider.valueAsNumber !== lastVolume) {
    // Continue from a change made with the mouse or the original mix button.
    volumeDrag.startY = currentY;
    volumeDrag.startVolume = slider.valueAsNumber;
  } else {
    setStemVolume(stemId, startVolume + (startY - currentY) * 100 / volumeTravel);
  }
  volumeDrag.lastVolume = slider.valueAsNumber;
}

function getPinchRatio(hand) {
  const aspect = video.videoWidth / video.videoHeight;
  const distance = (a, b) => Math.hypot((hand[a].x - hand[b].x) * aspect, hand[a].y - hand[b].y);
  // Average the palm width and length to compensate for distance from the camera.
  const palmSize = (distance(5, 17) + distance(0, 9)) / 2;
  return palmSize > 0 ? distance(thumbTip, indexTip) / palmSize : NaN;
}

function selectCard(card) {
  if (selectedCard === card) return;
  selectedCard?.classList.remove('is-hand-selected');
  selectedCard = card;
  if (card) {
    card.classList.add('is-hand-selected');
    cursor.dataset.track = card.dataset.track;
  } else {
    delete cursor.dataset.track;
  }
}

function stopTracking(active) {
  if (session !== active) return;
  session = undefined;
  cursor.hidden = true;
  handReady.hidden = true;
  startButton.classList.remove('is-hand-pointed');
  updateDwell(null);
  grabCard(null);
  selectCard(null);
  cancelAnimationFrame(active.frame);
  active.stream?.getTracks().forEach(track => track.stop());
  video.srcObject = null;
  active.landmarker?.close();
}

async function startTracking() {
  if (session || !navigator.mediaDevices?.getUserMedia) return;
  const active = {};
  session = active;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: 'user' },
        width: { ideal: 640 },
        height: { ideal: 480 },
      },
    });
    if (session !== active) {
      stream.getTracks().forEach(track => track.stop());
      return;
    }
    active.stream = stream;
    stream.getVideoTracks()[0].addEventListener('ended', () => stopTracking(active), { once: true });

    const { FilesetResolver, HandLandmarker } = await import(`${visionPackage}/vision_bundle.mjs`);
    const files = await FilesetResolver.forVisionTasks(`${visionPackage}/wasm`);
    if (session !== active) return;
    const landmarker = await HandLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: modelUrl },
      runningMode: 'VIDEO',
      numHands: 1,
    });
    if (session !== active) {
      landmarker.close();
      return;
    }
    active.landmarker = landmarker;
    video.srcObject = stream;
    await video.play();
    if (session !== active) return;

    let lastVideoTime = -1;
    let lastFrameTime = 0;
    let lastHandTime = -Infinity;
    let position;
    let candidate = null;
    let candidateSince = 0;
    let pinchState = 'open';
    let pinchFrames = 0;
    let pinchingStart = false;

    function trackFrame(timestamp) {
      try {
        if (!cursor.hidden && timestamp - lastHandTime >= trackingGraceMs) {
          position = undefined;
          candidate = null;
          pinchState = 'awaiting-open';
          pinchFrames = 0;
          cursor.hidden = true;
          handReady.hidden = true;
          startButton.classList.remove('is-hand-pointed');
          updateDwell(null);
          grabCard(null);
          selectCard(null);
        }

        if (mixer.hidden && grabbedCard) {
          grabCard(null);
          selectCard(null);
        }

        if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.currentTime !== lastVideoTime) {
          lastVideoTime = video.currentTime;
          const { landmarks } = landmarker.detectForVideo(video, timestamp);
          const hand = landmarks[0];
          const tip = hand?.[indexTip];
          if (tip) {
            lastHandTime = timestamp;
            const x = clamp(1 - tip.x);
            const y = clamp(tip.y);
            const weight = 1 - Math.exp(-(timestamp - lastFrameTime) / smoothingMs);
            position = position
              ? { x: position.x + (x - position.x) * weight, y: position.y + (y - position.y) * weight }
              : { x, y };
            cursor.style.left = `${position.x * 100}%`;
            cursor.style.top = `${position.y * 100}%`;
            cursor.hidden = false;
            handReady.hidden = !canStartExperience();

            const viewport = document.documentElement;
            const target = document.elementFromPoint(
              position.x * viewport.clientWidth,
              position.y * viewport.clientHeight,
            );
            const card = target?.closest('.tracks .track') ?? null;
            const button = target?.closest('button');
            const pointingAtStart = button === startButton && canStartExperience();
            startButton.classList.toggle('is-hand-pointed', pointingAtStart);
            const palm = { x: hand[9].x * viewport.clientWidth, y: hand[9].y * viewport.clientHeight };

            const pinchRatio = getPinchRatio(hand);
            const pinchChanged = pinchState === 'open'
              ? pinchRatio <= pinchStartRatio
              : pinchRatio >= pinchReleaseRatio;
            pinchFrames = pinchChanged ? pinchFrames + 1 : 0;
            if (pinchState === 'open' && pinchFrames === 1) pinchingStart = pointingAtStart;
            if (volumeDrag && !volumeDrag.dragging
                && Math.hypot(palm.x - volumeDrag.palm.x, palm.y - volumeDrag.palm.y) > dragThresholdPx) {
              volumeDrag.dragging = true;
              grabbedCard.querySelector('.grab-status').textContent = 'ADJUSTING';
            }
            if (pinchFrames >= pinchConfirmationFrames) {
              pinchFrames = 0;
              candidate = null;
              if (pinchState === 'open') {
                pinchState = 'closed';
                if (pinchingStart) {
                  startButton.classList.remove('is-hand-pointed');
                  startExperience();
                } else {
                  grabCard(card, position.y, palm, timestamp);
                }
              } else {
                pinchState = 'open';
                if (volumeDrag && !volumeDrag.dragging && !volumeDrag.interrupted
                    && timestamp - volumeDrag.startedAt <= shortPinchMs) {
                  toggleStem(volumeDrag.stemId);
                }
                grabCard(null);
              }
            }

            if (volumeDrag?.dragging && !pinchChanged) adjustGrabbedVolume(position.y);

            let action = null;
            if (pinchState === 'open' && !pinchChanged) {
              if (button === finishButton && !mixer.hidden) action = button;
            }
            updateDwell(action, timestamp);

            if (!grabbedCard) {
              if (card !== candidate) {
                candidate = card;
                candidateSince = timestamp;
              }
              if (selectedCard !== card) selectCard(null);
              if (card && timestamp - candidateSince >= selectionDwellMs) selectCard(card);
            }
          } else {
            candidate = null;
            pinchFrames = 0;
            if (volumeDrag) volumeDrag.interrupted = true;
            handReady.hidden = true;
            startButton.classList.remove('is-hand-pointed');
            updateDwell(null);
          }
          lastFrameTime = timestamp;
        }
        active.frame = requestAnimationFrame(trackFrame);
      } catch (error) {
        stopTracking(active);
        console.warn('손 추적을 계속할 수 없습니다.', error);
      }
    }

    active.frame = requestAnimationFrame(trackFrame);
  } catch (error) {
    if (session !== active) return;
    stopTracking(active);
    console.warn('손 추적을 시작할 수 없습니다.', error);
  }
}

window.addEventListener('pagehide', () => {
  if (session) stopTracking(session);
});
window.addEventListener('pageshow', event => {
  if (event.persisted) startTracking();
});
startTracking();
