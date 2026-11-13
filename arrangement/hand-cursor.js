import { powerButton, turntable } from './turntable.js';

const visionPackage = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21';
const modelUrl = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const indexTip = 8;
const thumbTip = 4;
const pinchStartRatio = 0.25;
const pinchReleaseRatio = 0.40;
const pinchConfirmationFrames = 3;
const controlPinchStartRatio = 0.34;
const controlPinchFrames = 2;
const buttonHitSlopPx = 14;
const smoothingMs = 75;
const selectionDwellMs = 120;
const trackingGraceMs = 300;
const shortPinchMs = 350;
const stemHitSlopPx = 10;
const filterTravel = 0.38; // Fraction of the screen height across the full cutoff range.
const filterDeadZonePx = 6;
const volumeTravel = 0.4; // Fraction of the screen height for a 0–100% adjustment.
const hands = ['Left', 'Right'].map(side => ({
  side, cursor: document.querySelector(`[data-hand="${side}"]`),
  lastSeen: -Infinity, pinchState: 'open', pinchFrames: 0,
}));
const mixer = document.querySelector('#mixer');
const stemCards = [...mixer.querySelectorAll('.tracks .track')];
const pinchActions = new Map([
  [document.querySelector('#enter'), () => startExperience()],
  [document.querySelector('#waiting-original'), () => startExperience(true)],
  [document.querySelector('#finish'), () => {
    finishExperience();
    hands.forEach(resetHand);
  }],
  [document.querySelector('#original'), selectOriginalMix],
  [powerButton, turntable.togglePower],
]);
const forgivingButtons = new Set([enter, powerButton, finish, original, waitingOriginal]);
const handReady = document.querySelector('#hand-ready');
// Keep the video off the DOM so the TV only shows the cursor.
const video = document.createElement('video');
video.muted = true;
video.playsInline = true;

const clamp = value => Math.min(1, Math.max(0, value));
let session;
const reconnectDelayMs = 3000;
let reconnectTimer;
let pageActive = true;
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

function releaseFilter(hand) {
  if (!hand.filterDrag) return;
  owners.delete(hand.filterDrag.filter.control);
  hand.filterDrag = null;
}

function grabFilter(hand, filter) {
  if (owners.has(filter.control)) {
    hand.blockedControl = filter.control;
    return;
  }
  owners.set(filter.control, hand);
  hand.filterDrag = { filter, startY: hand.position.y, startPosition: filter.position };
  selectCard(hand, null);
}

function releaseControls(hand) {
  releaseFilter(hand);
  const card = hand.grabbedCard;
  if (card) {
    owners.delete(card);
    card.classList.remove('is-hand-grabbed');
    card.querySelector('.grab-status').hidden = true;
  }
  hand.grabbedCard = null;
  hand.blockedControl = null;
  hand.drag = null;
  hand.cursor.classList.remove('is-grabbing', 'is-locked');
}

function grabCard(hand, card, timestamp) {
  if (!card) return;
  if (owners.has(card)) {
    hand.blockedControl = card;
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
    stemId: card.dataset.track, slider, startY: hand.palmY,
    startVolume, lastVolume: startVolume, startedAt: timestamp,
    dragging: false, interrupted: false,
  };
}

function updateStemDrag(hand, viewportHeight) {
  const drag = hand.drag;
  if (drag.slider.valueAsNumber !== drag.lastVolume || drag.rebase) {
    drag.startY = hand.palmY;
    drag.startVolume = drag.slider.valueAsNumber;
    drag.lastVolume = drag.startVolume;
    drag.rebase = false;
  }

  const delta = drag.startY - hand.palmY;
  if (!drag.dragging) {
    if (Math.abs(delta) * viewportHeight < Math.max(8, viewportHeight * 0.013)) return;
    drag.dragging = true;
    hand.grabbedCard.querySelector('.grab-status').textContent = 'ADJUSTING';
  }
  setStemVolume(drag.stemId, drag.startVolume + delta * 100 / volumeTravel);
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
  hand.lastPinchRatio = undefined;
  hand.pointedButton = null;
  hand.pointedCartridge = false;
  hand.pointedFilter = false;
  releaseFilter(hand);
  if (turntable.heldBy(hand)) hand.armTrackingInterrupted = true;
  if (hand.drag) {
    hand.drag.interrupted = true;
    hand.drag.rebase = true;
  }
}

function resetHand(hand) {
  pauseHand(hand);
  turntable.cancel(hand);
  releaseControls(hand);
  selectCard(hand, null);
  hand.position = undefined;
  hand.palm = undefined;
  hand.palmY = undefined;
  hand.lastSeen = -Infinity;
  hand.pinchState = 'awaiting-open';
  hand.cursor.hidden = true;
}

const palmDistance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const hasGrab = hand => Boolean(hand.grabbedCard || hand.filterDrag || turntable.heldBy(hand));

function matchHands({ landmarks, handedness, handednesses }) {
  const detections = landmarks.slice(0, 2).map((points, index) => {
    const category = (handedness ?? handednesses)?.[index]?.[0];
    return { points, palm: points[9], side: category?.score >= 0.65 ? category.categoryName : null };
  });
  const [first, second] = detections;
  if (second && palmDistance(first.palm, second.palm) < 0.065) {
    const holdingArm = hands.some(hand => turntable.heldBy(hand));
    const ambiguous = !first.side || !second.side || first.side === second.side;
    if (holdingArm || (ambiguous && hands.some(hasGrab))) return [null, null];
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
    // A confidently identified hand can stay on its own control when the hands cross.
    const confidentGrab = (hand.filterDrag || hand.grabbedCard)
      && detection.side === hand.side && distance <= 0.20;
    if (hasGrab(hand) && (distance > 0.28
        || (!confidentGrab && (!second || distance > 0.12) && other.palm
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

function distanceToControl(control, x, y) {
  const rect = control.getBoundingClientRect();
  const dx = Math.max(0, rect.left - x, x - rect.right);
  const dy = Math.max(0, rect.top - y, y - rect.bottom);
  return Math.hypot(dx, dy);
}

function findPinchButton(target, x, y) {
  const exact = target?.closest('button');
  if (exact) return pinchActions.has(exact) && !exact.disabled ? exact : null;
  if (!target || target.closest('.track, .filter-knob, #cartridge')) return null;

  let hit = null;
  for (const button of forgivingButtons) {
    if (button.disabled || !button.getClientRects().length) continue;
    if (distanceToControl(button, x, y) > buttonHitSlopPx) continue;
    if (hit) return null; // Keep the gap between adjacent buttons neutral.
    hit = button;
  }
  return hit;
}

function findStemCard(target, x, y) {
  const card = target?.closest('.tracks .track');
  if (card) return card;
  if (mixer.hidden || target?.closest('button, input, .filter-knob, #cartridge')) return null;
  const nearby = stemCards.filter(stem => distanceToControl(stem, x, y) <= stemHitSlopPx);
  return nearby.length === 1 ? nearby[0] : null;
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
  hand.palmY = hand.palmY === undefined || hand.drag?.rebase
    ? palm.y : hand.palmY + (palm.y - hand.palmY) * weight;
  hand.cursor.style.left = `${hand.position.x * 100}%`;
  hand.cursor.style.top = `${hand.position.y * 100}%`;
  hand.cursor.hidden = false;

  const { clientWidth, clientHeight } = document.documentElement;
  const cursorX = hand.position.x * clientWidth;
  const cursorY = hand.position.y * clientHeight;
  const target = document.elementFromPoint(Math.min(cursorX, clientWidth - 1), Math.min(cursorY, clientHeight - 1));
  const holdingArm = turntable.heldBy(hand);
  const filterDrag = hand.filterDrag;
  hand.pointedFilter = hasGrab(hand) ? null : masterFilters.get(target);
  hand.pointedCartridge = target?.id === 'cartridge' && turntable.canGrab();
  const card = findStemCard(target, cursorX, cursorY);
  const canPinchButton = !hasGrab(hand) && (!mixer.hidden || canStartExperience());
  hand.pointedButton = canPinchButton ? findPinchButton(target, cursorX, cursorY) : null;
  const ratio = getPinchRatio(points);
  if (filterDrag && !Number.isFinite(ratio)) releaseFilter(hand);
  if (holdingArm) {
    if (!Number.isFinite(ratio)) hand.armTrackingInterrupted = true;
    else if (ratio <= pinchStartRatio) hand.armTrackingInterrupted = false;
  }
  const opening = hand.pinchState !== 'open';
  const continuingPinch = hand.pinchFrames > 0;
  const aimedButton = continuingPinch ? hand.pinchButton : hand.pointedButton;
  const aimedCard = continuingPinch ? hand.pinchCard : card;
  const forgivingPinch = !opening && (forgivingButtons.has(aimedButton) || aimedCard)
    && (continuingPinch || hand.lastPinchRatio > controlPinchStartRatio);
  const closeRatio = forgivingPinch ? controlPinchStartRatio : pinchStartRatio;
  const pinchChanged = opening ? ratio >= pinchReleaseRatio : ratio <= closeRatio;
  hand.lastPinchRatio = ratio;
  hand.pinchFrames = pinchChanged ? hand.pinchFrames + 1 : 0;
  if (!opening && hand.pinchFrames === 1) {
    hand.pinchButton = forgivingPinch || !forgivingButtons.has(hand.pointedButton) ? hand.pointedButton : null;
    hand.pinchCard = card;
    hand.pinchCartridge = hand.pointedCartridge;
    hand.pinchFilter = hand.pointedFilter;
  }
  if (holdingArm && !hand.armTrackingInterrupted && (!pinchChanged || hand.pinchFrames === 1)) {
    turntable.move(hand, cursorX, cursorY);
  }

  const drag = hand.drag;
  if (hand.pinchFrames >= (forgivingPinch ? controlPinchFrames : pinchConfirmationFrames)) {
    hand.pinchFrames = 0;
    hand.candidate = null;
    if (!opening) {
      hand.pinchState = 'closed';
      const action = pinchActions.get(hand.pinchButton);
      if (action) {
        action();
        return;
      }
      if (hand.pinchFilter) {
        grabFilter(hand, hand.pinchFilter);
        return;
      }
      if (hand.pinchCartridge) {
        if (turntable.grab(hand, cursorX, cursorY)) {
          hand.armTrackingInterrupted = false;
          selectCard(hand, null);
        }
        return;
      }
      grabCard(hand, hand.pinchCard, timestamp);
    } else {
      hand.pinchState = 'open';
      if (holdingArm) {
        if (hand.armTrackingInterrupted) turntable.cancel(hand);
        else turntable.release(hand, x * clientWidth, y * clientHeight);
      }
      if (drag && !drag.dragging && !drag.interrupted && timestamp - drag.startedAt <= shortPinchMs) {
        toggleStem(drag.stemId);
      }
      releaseControls(hand);
    }
  }

  if (hand.drag && !pinchChanged && Number.isFinite(ratio)) updateStemDrag(hand, clientHeight);
  if (hand.filterDrag && !pinchChanged) {
    const { filter, startY, startPosition } = hand.filterDrag;
    const delta = startY - hand.position.y;
    const travel = Math.max(0, Math.abs(delta) - filterDeadZonePx / clientHeight);
    setMasterFilterPosition(filter, startPosition + Math.sign(delta) * travel / filterTravel);
  }

  if (!hand.grabbedCard && !holdingArm && !filterDrag) {
    if (card !== hand.candidate) {
      hand.candidate = card;
      hand.candidateSince = timestamp;
    }
    if (hand.selectedCard !== card) selectCard(hand, null);
    if (card && timestamp - hand.candidateSince >= selectionDwellMs) selectCard(hand, card);
  }
}

function updateControls() {
  for (const hand of hands) {
    hand.cursor.classList.toggle('is-locked', owners.has(hand.blockedControl));
    hand.cursor.classList.toggle('is-grabbing', hasGrab(hand));
  }
  for (const [control, filter] of masterFilters) {
    filter.panel.classList.toggle('is-filter-pointed', hands.some(hand => hand.pointedFilter === filter));
    filter.panel.classList.toggle('is-filter-grabbed', owners.has(control));
  }
  turntable.pointAtCartridge(hands.some(hand => hand.pointedCartridge));
  const canStart = canStartExperience();
  handReady.hidden = !canStart || hands.every(hand => hand.cursor.hidden);
  for (const button of pinchActions.keys()) {
    const pointed = hands.some(hand => {
      if (hand.pointedButton !== button) return false;
      if (!forgivingButtons.has(button)) return true;
      return hand.pinchState === 'open'
        && (hand.lastPinchRatio > controlPinchStartRatio
          || (hand.pinchFrames > 0 && hand.pinchButton === button));
    });
    button.classList.toggle('is-hand-pointed', pointed);
  }
}

mixer.addEventListener('masterfiltersreset', () => {
  hands.forEach(releaseFilter);
  updateControls();
});

function stopTracking(active) {
  if (session !== active) return;
  session = undefined;
  hands.forEach(resetHand);
  updateControls();
  cancelAnimationFrame(active.frame);
  active.stream?.getTracks().forEach(track => track.stop());
  video.pause();
  video.srcObject = null;
  active.landmarker?.close();
}

function reconnectTracking(active) {
  if (session !== active) return;
  stopTracking(active);
  if (!pageActive || reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = undefined;
    startTracking();
  }, reconnectDelayMs);
}

async function startTracking() {
  if (!pageActive || session || !navigator.mediaDevices?.getUserMedia) return;
  clearTimeout(reconnectTimer);
  reconnectTimer = undefined;
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
    stream.getVideoTracks()[0].addEventListener('ended', () => reconnectTracking(active), { once: true });

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
      if (session !== active) return;
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
          updateControls();
        }
        wasMixing = !mixer.hidden;
        active.frame = requestAnimationFrame(trackFrame);
      } catch (error) {
        reconnectTracking(active);
        console.warn('손 추적을 계속할 수 없습니다.', error);
      }
    }

    active.frame = requestAnimationFrame(trackFrame);
  } catch (error) {
    if (session !== active) return;
    // A denied/dismissed permission needs the visitor's permission change,
    // not repeated prompts. Device and loading failures retry automatically.
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') stopTracking(active);
    else reconnectTracking(active);
    console.warn('손 추적을 시작할 수 없습니다.', error);
  }
}

window.addEventListener('pagehide', () => {
  pageActive = false;
  clearTimeout(reconnectTimer);
  reconnectTimer = undefined;
  if (session) stopTracking(session);
});
window.addEventListener('pageshow', event => {
  pageActive = true;
  if (event.persisted) startTracking();
});
navigator.permissions?.query({ name: 'camera' }).then(permission => {
  permission.addEventListener('change', () => {
    if (permission.state === 'granted') startTracking();
  });
}).catch(() => {});
startTracking();
