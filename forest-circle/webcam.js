'use strict';

const cameraButton = document.querySelector('#camera-button');
const cameraStatus = document.querySelector('#camera-status');
const cameraView = document.querySelector('#camera-view');
const cameraGuide = document.querySelector('#camera-guide');
const cameraVideo = document.querySelector('#camera-video');
const faceCanvas = document.querySelector('#face-canvas');
const faceContext = faceCanvas.getContext('2d');
let cameraStream = null;
let cameraRequest = 0;

function stopCamera(status = '카메라를 연결하면 내 얼굴로 요정을 만들 수 있어요.') {
  cameraRequest++;
  const stream = cameraStream;
  cameraStream = null;
  if (stream) stream.getTracks().forEach(track => track.stop());
  cameraVideo.pause();
  cameraVideo.srcObject = null;
  cameraView.hidden = true;
  fairy.classList.remove('camera-ready');
  faceContext.clearRect(0, 0, faceCanvas.width, faceCanvas.height);
  cameraButton.disabled = false;
  cameraButton.textContent = '카메라 연결';
  cameraButton.setAttribute('aria-pressed', 'false');
  cameraStatus.textContent = status;
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    cameraStatus.textContent = '이 창에서는 카메라를 연결할 수 없어요. Chrome에서 예제3.html 파일을 열어 주세요.';
    return;
  }
  const request = ++cameraRequest;
  cameraButton.disabled = true;
  cameraStatus.textContent = '카메라 사용 안내가 나오면 허용을 눌러 주세요.';
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false
    });
    if (request !== cameraRequest) {
      stream.getTracks().forEach(track => track.stop());
      return;
    }
    cameraStream = stream;
    cameraVideo.srcObject = stream;
    // Reveal before playback so browsers do not defer a hidden video's frames.
    cameraView.hidden = false;
    await cameraVideo.play();
    if (request !== cameraRequest) return;
    const track = stream.getVideoTracks()[0];
    if (!track || track.readyState === 'ended') throw new Error('CameraEnded');
    track.addEventListener('ended', () => {
      if (cameraStream === stream) stopCamera('카메라 연결이 끊겼어요. 다시 연결해 주세요.');
    });
    cameraButton.textContent = '카메라 끄기';
    cameraButton.setAttribute('aria-pressed', 'true');
    cameraStatus.textContent = '얼굴을 점선 안에 맞추고, 왼쪽 버튼을 누른 채 원을 계속 그려보세요.';
    updateFaceGuide();
  } catch (error) {
    if (request !== cameraRequest) return;
    const messages = {
      NotAllowedError: '카메라 사용을 허용한 뒤 다시 연결해 주세요.',
      NotFoundError: '연결된 웹캠이 없어요. 웹캠을 연결해 주세요.',
      NotReadableError: '다른 앱이 카메라를 사용 중일 수 있어요. 해당 앱을 닫고 다시 연결해 주세요.'
    };
    stopCamera(messages[error.name] || '카메라 연결을 마치지 못했어요. 웹캠을 확인하고 다시 연결해 주세요.');
  } finally {
    if (request === cameraRequest) cameraButton.disabled = false;
  }
}

function faceCrop() {
  const h = cameraVideo.videoHeight * .66;
  const w = Math.min(cameraVideo.videoWidth, h * faceCanvas.width / faceCanvas.height);
  return { x: (cameraVideo.videoWidth - w) / 2,
    y: (cameraVideo.videoHeight - h) / 2, w, h };
}

function updateFaceGuide() {
  if (!cameraVideo.videoWidth || !cameraVideo.videoHeight) return;
  const crop = faceCrop();
  cameraView.style.aspectRatio = `${cameraVideo.videoWidth} / ${cameraVideo.videoHeight}`;
  cameraGuide.style.width = `${crop.w / cameraVideo.videoWidth * 100}%`;
}

function drawFace() {
  if (!cameraStream || cameraVideo.readyState < 2 || !cameraVideo.videoWidth || !summoned) return;
  const crop = faceCrop();
  faceContext.setTransform(-1, 0, 0, 1, faceCanvas.width, 0);
  faceContext.drawImage(cameraVideo, crop.x, crop.y, crop.w, crop.h,
    0, 0, faceCanvas.width, faceCanvas.height);
  faceContext.setTransform(1, 0, 0, 1, 0, 0);
  fairy.classList.add('camera-ready');
}

cameraButton.addEventListener('click', () => {
  if (cameraStream) stopCamera();
  else startCamera();
});
cameraVideo.addEventListener('loadedmetadata', updateFaceGuide);
window.addEventListener('pagehide', () => stopCamera());
