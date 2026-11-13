const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

async function fixture() {
  const nodes = new Map();
  const calls = [];
  const rectangles = new Map();
  let pointed;
  let held;
  function element(name, kind = '') {
    if (nodes.has(name)) return nodes.get(name);
    const classes = new Set();
    const node = Object.assign(new EventTarget(), {
      id: name.replace('#', ''), kind, hidden: false, disabled: false, dataset: {}, style: {}, valueAsNumber: 50,
      classList: { add: (...items) => items.forEach(item => classes.add(item)),
        remove: (...items) => items.forEach(item => classes.delete(item)),
        toggle: (item, on) => on ? classes.add(item) : classes.delete(item) },
      closest(selector) {
        return selector.split(',').map(s => s.trim()).some(s => s === this.kind || s === '#' + this.id
          || (this.kind === '.track' && s === '.tracks .track')) ? this : null;
      },
      contains: target => target === node,
      querySelector: selector => element(name + ' ' + selector),
      querySelectorAll: () => [],
      getClientRects: () => node.hidden ? [] : [node.getBoundingClientRect()],
      getBoundingClientRect: () => rectangles.get(name) || { left: -1000, top: -1000, right: -900, bottom: -900 },
    });
    nodes.set(name, node);
    return node;
  }
  for (const name of ['#enter', '#waiting-original', '#finish', '#original', '#power']) element(name, 'button');
  const stems = ['drum', 'bass', 'synth', 'vocal'].map(id => {
    const node = element('#' + id, '.track');
    node.dataset.track = id;
    node.querySelector = selector => element('#' + id + ' ' + selector);
    return node;
  });
  const mixer = element('#mixer');
  mixer.querySelectorAll = () => stems;
  const filters = new Map(['lpf', 'hpf'].map(id => {
    const control = element('#' + id, 'input');
    return [control, { control, panel: element('#' + id + '-panel'), position: 0.5 }];
  }));
  const video = { videoWidth: 640, videoHeight: 480, pause() {} };
  const context = vm.createContext({
    document: { querySelector: element, createElement: () => video,
      documentElement: { clientWidth: 1920, clientHeight: 1080 }, elementFromPoint: () => pointed },
    window: new EventTarget(), navigator: {}, console,
    enter: element('#enter'), finish: element('#finish'), original: element('#original'),
    waitingOriginal: element('#waiting-original'), masterFilters: filters,
    canStartExperience: () => true,
    startExperience: original => calls.push(['start', original]),
    finishExperience: () => calls.push(['finish']), selectOriginalMix: () => calls.push(['original']),
    toggleStem: id => calls.push(['toggle', id]),
    setStemVolume: (id, value) => { element('#' + id + ' .volume').valueAsNumber = value; calls.push(['volume', id, value]); },
    setMasterFilterPosition: (filter, value) => { filter.position = value; calls.push(['filter', filter.control.id, value]); },
  });
  const turntable = {
    togglePower: () => calls.push(['power']), canGrab: () => !held, heldBy: hand => held === hand,
    grab: (hand, x, y) => { held = hand; calls.push(['grab', hand.side, x, y]); return true; },
    move: (hand, x, y) => calls.push(['move', hand.side, x, y]),
    release: (hand, x, y) => { held = null; calls.push(['release', hand.side, x, y]); },
    cancel: hand => { if (held === hand) { held = null; calls.push(['cancel', hand.side]); } },
    pointAtCartridge() {},
  };
  const dependency = new vm.SyntheticModule(['powerButton', 'turntable'], function () {
    this.setExport('powerButton', element('#power'));
    this.setExport('turntable', turntable);
  }, { context });
  const source = fs.readFileSync(path.join(__dirname, '../arrangement/hand-cursor.js'), 'utf8');
  // Expose the real implementation only inside the test VM.
  const module = new vm.SourceTextModule(source + '\nexport { hands, owners, updateHand, resetHand, pauseHand, matchHands, getPinchRatio, smoothPosition, confirmPinch, findPinchButton, findStemCard, findPrecisionControl };', { context });
  await module.link(() => dependency);
  await module.evaluate();
  const api = module.namespace;
  function pose(ratio, x = 0.5, y = 0.5, size = 0.12) {
    const points = Array.from({ length: 21 }, () => ({ x: 1 - x, y, z: 0 }));
    points[0] = { x: 1 - x, y: y + size, z: 0 };
    points[9] = { x: 1 - x, y, z: 0 };
    points[5] = { x: 1 - x - size / 2 / (4 / 3), y, z: 0 };
    points[17] = { x: 1 - x + size / 2 / (4 / 3), y, z: 0 };
    points[8] = { x: 1 - x, y: y - size, z: 0 };
    points[4] = { x: 1 - x + size * ratio / (4 / 3), y: y - size, z: 0 };
    return { points, palm: points[9], side: 'Left' };
  }
  return { api, calls, video, nodes, rectangles, filters, element, stems, pose,
    point(node) { pointed = node; },
    feed(ratio, time, hand = api.hands[0], x = 0.5, y = 0.5) { api.updateHand(hand, pose(ratio, x, y), time); },
  };
}

test('pinch distance is independent of apparent hand size and camera aspect', async () => {
  const f = await fixture();
  for (const size of [0.04, 0.12, 0.3]) {
    const pose = f.pose(0.3, 0.5, 0.5, size);
    assert.ok(Math.abs(f.api.getPinchRatio(pose.points) - 0.3) < 1e-8);
    f.video.videoWidth = 1280; f.video.videoHeight = 720;
    const stretched = pose.points.map(p => ({ ...p, x: 0.5 + (p.x - 0.5) * 0.75 }));
    assert.ok(Math.abs(f.api.getPinchRatio(stretched) - 0.3) < 1e-8);
    f.video.videoWidth = 640; f.video.videoHeight = 480;
  }
});

test('tiny or invalid hands cannot trigger pinch actions', async () => {
  const f = await fixture();
  const p = f.pose(0.27);
  assert.ok(Number.isNaN(f.api.getPinchRatio(f.pose(0.1, 0.5, 0.5, 0.005).points)));
  p.points[4].x = NaN;
  assert.ok(Number.isNaN(f.api.getPinchRatio(p.points)));
});

test('pinch confirmation takes elapsed time, not frame count, at 10/30/60 fps', async () => {
  const f = await fixture();
  for (const fps of [10, 30, 60]) {
    const hand = { pinchFrames: 0 };
    const dt = 1000 / fps;
    let accepted;
    for (let time = 0; time < 300; time += dt) {
      if (f.api.confirmPinch(hand, true, time, false)) { accepted = time; break; }
    }
    assert.ok(accepted >= 70 && accepted <= 70 + dt + 0.001);
  }
  const hand = { pinchFrames: 0 };
  assert.equal(f.api.confirmPinch(hand, true, 0, false), false);
  assert.equal(f.api.confirmPinch(hand, false, 40, false), false);
  assert.equal(f.api.confirmPinch(hand, true, 80, false), false);
});

test('stationary cursor jitter is reduced while a deliberate move remains responsive', async () => {
  const f = await fixture();
  let previous = { x: 0.5, y: 0.5 };
  let filteredError = 0, rawError = 0;
  for (let i = 0; i < 60; i++) {
    const raw = { x: 0.5 + (i % 2 ? 0.006 : -0.006), y: 0.5 };
    previous = f.api.smoothPosition(previous, raw, 1000 / 30);
    filteredError += Math.abs(previous.x - 0.5); rawError += Math.abs(raw.x - 0.5);
  }
  assert.ok(filteredError < rawError * 0.25);
  for (let i = 0; i < 6; i++) previous = f.api.smoothPosition(previous, { x: 0.8, y: 0.5 }, 1000 / 30);
  assert.ok(previous.x > 0.78, 'intentional movement reaches target within 200ms');
});

test('entering already pinched cannot click; one open-close cycle triggers POWER once', async () => {
  const f = await fixture(); f.point(f.element('#power'));
  for (let t = 0; t <= 240; t += 40) f.feed(0.1, t);
  assert.equal(f.calls.length, 0);
  for (let t = 280; t <= 440; t += 40) f.feed(0.8, t);
  for (let t = 480; t <= 760; t += 40) f.feed(0.2, t);
  assert.equal(f.calls.filter(call => call[0] === 'power').length, 1);
  for (let t = 800; t <= 1000; t += 40) f.feed(0.39, t);
  assert.equal(f.calls.length, 1, 'hysteresis prevents repeated clicks near release threshold');
});

test('brief pinch is ignored and a confirmed pinch stays on its original button', async () => {
  const f = await fixture(); f.point(f.element('#enter'));
  for (let t = 0; t <= 200; t += 40) f.feed(0.8, t);
  f.feed(0.1, 240); f.feed(0.8, 280);
  assert.equal(f.calls.length, 0);
  f.feed(0.1, 320);
  f.point(f.element('#finish'));
  for (let t = 360; t <= 480; t += 40) f.feed(0.1, t);
  assert.equal(f.calls.filter(c => c[0] === 'start').length, 1);
  assert.equal(f.calls.filter(c => c[0] === 'finish').length, 0);
});

test('tracking loss while held closed does not produce a fresh click on recovery', async () => {
  const f = await fixture(); f.point(f.element('#power'));
  for (let t = 0; t <= 160; t += 40) f.feed(0.8, t);
  for (let t = 200; t <= 320; t += 40) f.feed(0.2, t);
  f.api.updateHand(f.api.hands[0], null, 360);
  for (let t = 400; t <= 600; t += 40) f.feed(0.2, t);
  assert.equal(f.calls.filter(call => call[0] === 'power').length, 1);
});

test('expanded hit areas accept nearby points, reject overlaps and respect visible controls', async () => {
  const f = await fixture(); const blank = f.element('#background');
  f.rectangles.set('#power', { left: 100, top: 100, right: 200, bottom: 160 });
  assert.equal(f.api.findPinchButton(blank, 215, 130), f.element('#power'));
  f.rectangles.set('#finish', { left: 230, top: 100, right: 330, bottom: 160 });
  assert.equal(f.api.findPinchButton(blank, 215, 130), null);
  f.rectangles.set('#lpf', { left: 400, top: 100, right: 480, bottom: 180 });
  assert.equal(f.api.findPrecisionControl(blank, 495, 140), f.element('#lpf'));
  f.element('#mixer').hidden = true;
  assert.equal(f.api.findPrecisionControl(blank, 495, 140), null);
});

test('left and right hands independently grab and adjust different stems', async () => {
  const f = await fixture();
  for (let side = 0; side < 2; side++) {
    f.point(f.stems[side]); const hand = f.api.hands[side];
    for (let t = 0; t <= 160; t += 40) f.feed(0.8, t, hand);
    for (let t = 200; t <= 320; t += 40) f.feed(0.2, t, hand);
  }
  assert.equal(f.api.owners.size, 2);
  f.point(f.stems[0]);
  for (let t = 360; t <= 560; t += 40) f.feed(0.2, t, f.api.hands[0], 0.5, 0.3);
  f.point(f.stems[1]);
  for (let t = 360; t <= 560; t += 40) f.feed(0.2, t, f.api.hands[1], 0.5, 0.7);
  assert.ok(f.element('#drum .volume').valueAsNumber > 50);
  assert.ok(f.element('#bass .volume').valueAsNumber < 50);
  for (const hand of f.api.hands) f.api.resetHand(hand);
  assert.equal(f.api.owners.size, 0);
});

test('LPF and HPF use separate ownership and palm movement', async () => {
  const f = await fixture();
  for (let side = 0; side < 2; side++) {
    const control = f.element(side ? '#hpf' : '#lpf');
    f.point(control); const hand = f.api.hands[side];
    for (let t = 0; t <= 160; t += 40) f.feed(0.8, t, hand);
    for (let t = 200; t <= 320; t += 40) f.feed(0.2, t, hand);
    for (let t = 360; t <= 520; t += 40) f.feed(0.2, t, hand, 0.5, side ? 0.6 : 0.4);
  }
  assert.ok(f.filters.get(f.element('#lpf')).position > 0.5);
  assert.ok(f.filters.get(f.element('#hpf')).position < 0.5);
  assert.equal(f.api.owners.size, 2);
});

test('a short stem pinch toggles once; a held pinch cannot take another hand’s stem', async () => {
  const f = await fixture(); f.point(f.stems[0]);
  for (let t = 0; t <= 160; t += 40) f.feed(0.8, t);
  for (let t = 200; t <= 320; t += 40) f.feed(0.2, t);
  for (let t = 360; t <= 480; t += 40) f.feed(0.8, t);
  assert.equal(f.calls.filter(c => c[0] === 'toggle' && c[1] === 'drum').length, 1);
  assert.equal(f.api.owners.size, 0);
  for (let t = 520; t <= 640; t += 40) f.feed(0.2, t);
  const other = f.api.hands[1];
  for (let t = 520; t <= 680; t += 40) f.feed(0.8, t, other);
  for (let t = 720; t <= 840; t += 40) f.feed(0.2, t, other);
  assert.equal(f.api.owners.get(f.stems[0]), f.api.hands[0]);
  assert.equal(other.grabbedCard, null);
});

test('cartridge releases using the same filtered cursor used to move it', async () => {
  const f = await fixture(); f.point(f.element('#cartridge'));
  for (let t = 0; t <= 160; t += 40) f.feed(0.8, t);
  for (let t = 200; t <= 320; t += 40) f.feed(0.2, t);
  assert.equal(f.calls.filter(c => c[0] === 'grab').length, 1);
  for (let t = 360; t <= 520; t += 40) f.feed(0.2, t, f.api.hands[0], 0.6, 0.4);
  for (let t = 560; t <= 680 && !f.calls.some(c => c[0] === 'release'); t += 40)
    f.feed(0.8, t, f.api.hands[0], 0.62, 0.4);
  const release = f.calls.find(c => c[0] === 'release');
  assert.ok(release);
  assert.equal(release[2], f.api.hands[0].position.x * 1920);
  assert.equal(release[3], f.api.hands[0].position.y * 1080);
});

test('confident handedness keeps assignments when the detection list changes order', async () => {
  const f = await fixture(); const left = f.pose(0.8, 0.3), right = f.pose(0.8, 0.7);
  const result = f.api.matchHands({ landmarks: [right.points, left.points],
    handedness: [[{ categoryName: 'Right', score: 0.99 }], [{ categoryName: 'Left', score: 0.99 }]] });
  assert.equal(result[0].points, left.points);
  assert.equal(result[1].points, right.points);
});
