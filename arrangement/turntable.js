const scene = document.querySelector('.deck-scene');
const mixer = document.querySelector('#mixer');
const arm = scene.querySelector('.tonearm');
const cartridge = scene.querySelector('#cartridge');
const status = scene.querySelector('#turntable-status');

// All points use the width of the 4:3 artwork as their unit.
const pivot = { x: 0.903, y: 0.174 };
const head = { x: -0.094, y: 0.442 };
const needle = { x: -0.119, y: 0.488 };
const record = { x: 0.465, y: 0.375, inner: 0.13, outer: 0.35 };
const armLimit = 42;
const snapAngle = 6;
const snapDistance = 0.035;
const radians = degrees => degrees * Math.PI / 180;
const direction = ({ x, y }) => Math.atan2(y - pivot.y, x - pivot.x) * 180 / Math.PI;
const distanceToRecord = ({ x, y }) => Math.hypot(x - record.x, y - record.y);

function needleAt(degrees) {
  const a = radians(degrees);
  return {
    x: pivot.x + needle.x * Math.cos(a) - needle.y * Math.sin(a),
    y: pivot.y + needle.x * Math.sin(a) + needle.y * Math.cos(a),
  };
}

const grooveAngles = [];
for (let angle = 0; angle <= armLimit; angle += 0.25) {
  const distance = distanceToRecord(needleAt(angle));
  if (distance >= record.inner && distance <= record.outer) grooveAngles.push(angle);
}
const firstGroove = grooveAngles[0];
const lastGroove = grooveAngles.at(-1);

const states = {
  'power-off': 'POWER OFF',
  'needle-up': 'POWER ON / NEEDLE UP',
  'needle-down': 'POWER ON / NEEDLE DOWN',
};

let state = 'power-off';
let angle = 0;
let drag = null;

for (const [name, point] of Object.entries({ pivot, head, needle })) {
  scene.style.setProperty('--' + name + '-x', point.x * 100 + 'cqw');
  scene.style.setProperty('--' + name + '-y', point.y * 100 + 'cqw');
}

function render() {
  scene.dataset.state = state;
  scene.toggleAttribute('data-grabbed', Boolean(drag));
  scene.toggleAttribute('data-drop-ready', drag?.dropAngle != null);
  scene.style.setProperty('--arm-angle', angle + 'deg');
  powerButton.setAttribute('aria-pressed', String(state !== 'power-off'));
  if (status.textContent !== states[state]) status.textContent = states[state];
}

function pointOnDeck(clientX, clientY) {
  const rect = scene.getBoundingClientRect();
  return { x: (clientX - rect.left) / rect.width, y: (clientY - rect.top) / rect.width };
}

function park(nextState) {
  state = nextState;
  angle = 0;
  drag = null;
  render();
}

function togglePower() {
  if (!mixer.hidden) park(state === 'power-off' ? 'needle-up' : 'power-off');
}

function canGrab() {
  return !mixer.hidden && state !== 'power-off' && !drag;
}

function grab(owner, x, y) {
  if (!canGrab()) return false;
  const transform = getComputedStyle(arm).transform;
  if (transform !== 'none') {
    const matrix = new DOMMatrixReadOnly(transform);
    angle = Math.atan2(matrix.b, matrix.a) * 180 / Math.PI;
  }
  const aim = pointOnDeck(x, y);
  drag = { owner, offset: angle - direction(aim), dropAngle: null };
  state = 'needle-up';
  move(owner, x, y);
  return true;
}

function heldBy(owner) {
  return drag?.owner === owner;
}

function move(owner, x, y) {
  if (!heldBy(owner)) return;
  const aim = pointOnDeck(x, y);
  const aimedAngle = Math.max(0, Math.min(armLimit, direction(aim) + drag.offset));
  const grooveAngle = Math.max(firstGroove, Math.min(lastGroove, aimedAngle));
  const distance = distanceToRecord(aim);
  const nearGrooves = distance >= record.inner - snapDistance && distance <= record.outer + snapDistance;
  drag.dropAngle = nearGrooves && Math.abs(grooveAngle - aimedAngle) <= snapAngle ? grooveAngle : null;
  angle = drag.dropAngle ?? aimedAngle;
  render();
}

function release(owner) {
  if (!heldBy(owner)) return;
  if (drag.dropAngle == null) {
    park('needle-up');
    return;
  }
  angle = drag.dropAngle;
  drag = null;
  state = 'needle-down';
  render();
}

function cancel(owner) {
  if (heldBy(owner)) park('needle-up');
}

function pointAtCartridge(pointed) {
  scene.toggleAttribute('data-pointed', pointed && canGrab());
}

export const powerButton = scene.querySelector('#turntable-power');
export const turntable = { togglePower, canGrab, grab, heldBy, move, release, cancel, pointAtCartridge };
powerButton.addEventListener('click', togglePower);

cartridge.addEventListener('pointerdown', event => {
  if (event.button !== 0 || !grab(event.pointerId, event.clientX, event.clientY)) return;
  scene.setPointerCapture(event.pointerId);
  event.preventDefault();
});
scene.addEventListener('pointermove', event => move(event.pointerId, event.clientX, event.clientY));
scene.addEventListener('pointerup', event => {
  move(event.pointerId, event.clientX, event.clientY);
  release(event.pointerId);
});
scene.addEventListener('lostpointercapture', event => cancel(event.pointerId));

new MutationObserver(() => {
  if (mixer.hidden) park('power-off');
}).observe(mixer, { attributes: true, attributeFilter: ['hidden'] });
render();
