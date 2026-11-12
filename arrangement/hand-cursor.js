const visionPackage = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21';
const modelUrl = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const indexTip = 8;
const smoothingMs = 75;
const cursor = document.querySelector('.hand-cursor');
// Keep the video off the DOM so the TV only shows the cursor.
const video = document.createElement('video');
video.muted = true;
video.playsInline = true;

const clamp = value => Math.min(1, Math.max(0, value));
let session;

function stopTracking(active) {
  if (session !== active) return;
  session = undefined;
  cursor.hidden = true;
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
    let position;

    function trackFrame(timestamp) {
      try {
        if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.currentTime !== lastVideoTime) {
          lastVideoTime = video.currentTime;
          const { landmarks } = landmarker.detectForVideo(video, timestamp);
          const tip = landmarks[0]?.[indexTip];
          if (tip) {
            const x = clamp(1 - tip.x);
            const y = clamp(tip.y);
            const weight = 1 - Math.exp(-(timestamp - lastFrameTime) / smoothingMs);
            position = position
              ? { x: position.x + (x - position.x) * weight, y: position.y + (y - position.y) * weight }
              : { x, y };
            cursor.style.left = `${position.x * 100}%`;
            cursor.style.top = `${position.y * 100}%`;
            cursor.hidden = false;
          } else {
            position = undefined;
            cursor.hidden = true;
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
