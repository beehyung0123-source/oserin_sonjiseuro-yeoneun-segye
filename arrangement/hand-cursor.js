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
const hands = ['Left', 'Right'].map(side => ({
  side, cursor: document.querySelector(`[data-hand="${side}"]`),
  lastSeen: -Infinity, pinchState: 'open', pinchFrames: 0,
}));
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
const owners = new Map();

function selectCard(hand, card) {
  const previous = hand.selectedCard;
  if (previous === card) return;
  hand.selectedCard = card;
  if (previous && !hands.some(other => other.selectedCard === previous)) {
    previous.classList.remove('is-hand-selected');
  }
  if (card) {
    card.classList.add('is-hand-selected');
    hand.cursor.dataset.track = card.dataset.track;
  } else {
    delete hand.cursor.dataset.track;
  }
}

function releaseCard(hand) {
  const card = hand.grabbedCard;
  if (card) {
    owners.delete(card);
    card.classList.remove('is-hand-grabbed');
    card.querySelector('.grab-status').hidden = true;
  }
  hand.grabbedCard = null;
  hand.blockedCard = null;
  hand.drag = null;
  hand.cursor.classList.remove('is-grabbing', 'is-locked');
}

function grabCard(hand, card, palm, timestamp) {
  if (!card) return;
  if (owners.has(card)) {
    hand.blockedCard = card;
    return;
  }
  owners.set(card, hand);
  hand.grabbedCard = card;
  selectCard(hand, card);
  hand.cursor.classList.add('is-grabbing');
  card.classList.add('is-hand-grabbed');
  const status = card.querySelector('.grab-status');
  status.textContent = 'GRABBED';
  status.hidden = false;
  const slider = card.querySelector('.volume');
  const startVolume = slider.valueAsNumber;
  hand.drag = {
    stemId: card.dataset.track, slider, startY: hand.position.y,
    startVolume, lastVolume: startVolume, palm, startedAt: timestamp,
    dragging: false, interrupted: false,
  };
}

function adjustGrabbedVolume(drag, currentY) {
  if (drag.slider.valueAsNumber !== drag.lastVolume || drag.rebase) {
    drag.startY = currentY;
    drag.startVolume = drag.slider.valueAsNumber;
    drag.rebase = false;
  } else {
    setStemVolume(drag.stemId, drag.startVolume + (drag.startY - currentY) * 100 / volumeTravel);
  }
  drag.lastVolume = drag.slider.valueAsNumber;
}

function getPinchRatio(hand) {
  const aspect = video.videoWidth / video.videoHeight;
  const distance = (a, b) => Math.hypot((hand[a].x - hand[b].x) * aspect, hand[a].y - hand[b].y);
  // Average the palm width and length to compensate for distance from the camera.
  const palmSize = (distance(5, 17) + distance(0, 9)) / 2;
  return palmSize > 0 ? distance(thumbTip, indexTip) / palmSize : NaN;
}

function pauseHand(hand) {
  hand.candidate = null;
  hand.pinchFrames = 0;
  hand.pointingAtStart = false;
  hand.finishSince = undefined;
  if (hand.drag) {
    hand.drag.interrupted = true;
    hand.drag.rebase = true;
  }
}

function resetHand(hand) {
  pauseHand(hand);
  releaseCard(hand);
  selectCard(hand, null);
  hand.position = undefined;
  hand.palm = undefined;
  hand.lastSeen = -Infinity;
  hand.pinchState = 'awaiting-open';
  hand.cursor.hidden = true;
}

const palmDistance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function matchHands({ landmarks, handedness, handednesses }) {
  const detections = landmarks.slice(0, 2).map((points, index) => {
    const category = (handedness ?? handednesses)?.[index]?.[0];
    return { points, palm: points[9], side: category?.score >= 0.65 ? category.categoryName : null };
  });
  const [first, second] = detections;
  if (second && hands.some(hand => hand.grabbedCard) && palmDistance(first.palm, second.palm) < 0.065) {
    return [null, null];
  }

  function cost(hand, detection) {
    if (!detection) return 0.6;
    if (detection.side && detection.side !== hand.side) return Infinity;
    const other = hands.find(other => other !== hand);
    if (!hand.palm) {
      if (!second && other.palm && palmDistance(other.palm, detection.palm) < 0.065) return Infinity;
      return detection.side || !other.palm ? 0.28 : Infinity;
    }
    const distance = palmDistance(hand.palm, detection.palm);
    if (hand.grabbedCard && (distance > 0.28
        || ((!second || distance > 0.12) && other.palm
          && palmDistance(other.palm, detection.palm) + 0.04 < distance))) {
      return Infinity;
    }
    return distance;
  }

  // Compare both assignments, including unmatched hands. Close scores mean
  // identity is uncertain, so freeze only the slots whose assignments differ.
  const choices = [null, ...detections];
  let best = [null, null];
  let bestCost = Infinity;
  let alternative = best;
  let alternativeCost = Infinity;
  for (const left of choices) {
    for (const right of choices) {
      if (left && left === right) continue;
      const score = cost(hands[0], left) + cost(hands[1], right);
      if (score < bestCost) {
        alternative = best;
        alternativeCost = bestCost;
        best = [left, right];
        bestCost = score;
      } else if (score < alternativeCost) {
        alternative = [left, right];
        alternativeCost = score;
      }
    }
  }
  if (alternativeCost - bestCost < 0.045 && hands.some(hand => hand.palm)) {
    return best.map((detection, index) => detection === alternative[index] ? detection : null);
  }
  return best;
}

function updateHand(hand, detection, timestamp) {
  if (!detection) {
    pauseHand(hand);
    return;
  }

  const { points, palm } = detection;
  const tip = points[indexTip];
  const x = clamp(1 - tip.x);
  const y = clamp(tip.y);
  const weight = 1 - Math.exp(-(timestamp - hand.lastSeen) / smoothingMs);
  hand.position = hand.position && !hand.drag?.rebase
    ? { x: hand.position.x + (x - hand.position.x) * weight, y: hand.position.y + (y - hand.position.y) * weight }
    : { x, y };
  hand.lastSeen = timestamp;
  hand.palm = palm;
  hand.cursor.style.left = `${hand.position.x * 100}%`;
  hand.cursor.style.top = `${hand.position.y * 100}%`;
  hand.cursor.hidden = false;

  const { clientWidth, clientHeight } = document.documentElement;
  const target = document.elementFromPoint(hand.position.x * clientWidth, hand.position.y * clientHeight);
  const button = target?.closest('button');
  const card = target?.closest('.tracks .track') ?? null;
  hand.pointingAtStart = button === startButton && canStartExperience();
  const palmPixels = { x: palm.x * clientWidth, y: palm.y * clientHeight };
  const ratio = getPinchRatio(points);
  const opening = hand.pinchState !== 'open';
  const pinchChanged = opening ? ratio >= pinchReleaseRatio : ratio <= pinchStartRatio;
  hand.pinchFrames = pinchChanged ? hand.pinchFrames + 1 : 0;
  if (!opening && hand.pinchFrames === 1) hand.pinchingStart = hand.pointingAtStart;

  const drag = hand.drag;
  if (drag && !drag.dragging && palmDistance(palmPixels, drag.palm) > dragThresholdPx) {
    drag.dragging = true;
    hand.grabbedCard.querySelector('.grab-status').textContent = 'ADJUSTING';
  }
  if (hand.pinchFrames >= pinchConfirmationFrames) {
    hand.pinchFrames = 0;
    hand.candidate = null;
    if (!opening) {
      hand.pinchState = 'closed';
      if (hand.pinchingStart) startExperience();
      else grabCard(hand, card, palmPixels, timestamp);
    } else {
      hand.pinchState = 'open';
      if (drag && !drag.dragging && !drag.interrupted && timestamp - drag.startedAt <= shortPinchMs) {
        toggleStem(drag.stemId);
      }
      releaseCard(hand);
    }
  }

  if (hand.drag?.dragging && !pinchChanged) adjustGrabbedVolume(hand.drag, hand.position.y);
  if (button === finishButton && !mixer.hidden && hand.pinchState === 'open' && !pinchChanged) {
    hand.finishSince ??= timestamp;
  } else {
    hand.finishSince = undefined;
  }

  if (!hand.grabbedCard) {
    if (card !== hand.candidate) {
      hand.candidate = card;
      hand.candidateSince = timestamp;
    }
    if (hand.selectedCard !== card) selectCard(hand, null);
    if (card && timestamp - hand.candidateSince >= selectionDwellMs) selectCard(hand, card);
  }
}

function updateControls(timestamp) {
  for (const hand of hands) {
    hand.cursor.classList.toggle('is-locked', owners.has(hand.blockedCard));
  }
  const canStart = canStartExperience();
  handReady.hidden = !canStart || hands.every(hand => hand.cursor.hidden);
  startButton.classList.toggle('is-hand-pointed', canStart && hands.some(hand => hand.pointingAtStart));
  const dwell = Math.max(0, ...hands.map(hand => timestamp - (hand.finishSince ?? timestamp)));
  if (!mixer.hidden && dwell >= finishDwellMs) {
    finishExperience();
    hands.forEach(resetHand);
  }
  if (dwell > 0 && !mixer.hidden) finishButton.style.setProperty('--dwell-progress', `${dwell / finishDwellMs * 100}%`);
  else finishButton.style.removeProperty('--dwell-progress');
}

function stopTracking(active) {
  if (session !== active) return;
  session = undefined;
  hands.forEach(resetHand);
  updateControls(performance.now());
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
      numHands: 2,
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
    let wasMixing = !mixer.hidden;

    function trackFrame(timestamp) {
      try {
        if (wasMixing && mixer.hidden) hands.forEach(resetHand);
        for (const hand of hands) {
          if (hand.position && timestamp - hand.lastSeen >= trackingGraceMs) resetHand(hand);
        }
        if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.currentTime !== lastVideoTime) {
          lastVideoTime = video.currentTime;
          const matches = matchHands(landmarker.detectForVideo(video, timestamp));
          // Stable left-first ordering breaks ties when both pinch in one frame.
          hands.forEach((hand, index) => updateHand(hand, matches[index], timestamp));
          updateControls(timestamp);
        }
        wasMixing = !mixer.hidden;
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
