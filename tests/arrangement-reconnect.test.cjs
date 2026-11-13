// Run: node --experimental-vm-modules --test tests/arrangement-reconnect.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const source = readFileSync(join(__dirname, '../arrangement/hand-cursor.js'), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
const failure = name => Object.assign(new Error(name), { name });

async function fixture(outcomes = []) {
  const timers = new Map();
  const frames = new Map();
  const streams = [];
  const detectors = [];
  const warnings = [];
  const events = new EventTarget();
  const permission = Object.assign(new EventTarget(), { state: 'granted' });
  const elements = new Map();
  let calls = 0;
  let id = 0;
  function element(selector) {
    if (!elements.has(selector)) elements.set(selector, Object.assign(new EventTarget(), {
      hidden: true, dataset: {}, style: {}, querySelectorAll: () => [],
      classList: { add() {}, remove() {}, toggle() {} },
    }));
    return elements.get(selector);
  }
  function stream() {
    const track = Object.assign(new EventTarget(), { stops: 0, stop() { this.stops++; } });
    const result = { track, getTracks: () => [track], getVideoTracks: () => [track] };
    streams.push(result);
    return result;
  }
  const video = {
    readyState: 2, currentTime: 1, videoWidth: 640, videoHeight: 480,
    plays: 0, async play() { this.plays++; }, pause() {}, srcObject: null,
  };
  const context = vm.createContext({
    document: { querySelector: element, createElement: () => video },
    navigator: {
      mediaDevices: { async getUserMedia() {
        calls++;
        const outcome = outcomes.shift();
        if (outcome instanceof Error) throw outcome;
        return outcome ? await outcome : stream();
      } },
      permissions: { query: async () => permission },
    },
    window: events,
    console: { warn: (...args) => warnings.push(args) },
    HTMLMediaElement: { HAVE_CURRENT_DATA: 2 },
    setTimeout: (callback, delay) => { timers.set(++id, { callback, delay }); return id; },
    clearTimeout: key => timers.delete(key),
    requestAnimationFrame: callback => { frames.set(++id, callback); return id; },
    cancelAnimationFrame: key => frames.delete(key),
    enter: element('#enter'), finish: element('#finish'), original: element('#original'),
    waitingOriginal: element('#waiting-original'),
    selectOriginalMix() {}, canStartExperience: () => true, masterFilters: new Map(),
  });
  const turntable = new vm.SyntheticModule(['powerButton', 'turntable'], function () {
    this.setExport('powerButton', element('#power'));
    this.setExport('turntable', {
      togglePower() {}, cancel() {}, heldBy: () => false, pointAtCartridge() {},
    });
  }, { context });
  const vision = new vm.SyntheticModule(['FilesetResolver', 'HandLandmarker'], function () {
    this.setExport('FilesetResolver', { forVisionTasks: async () => ({}) });
    this.setExport('HandLandmarker', { async createFromOptions() {
      const detector = {
        closed: 0, detectForVideo: () => ({ landmarks: [] }), close() { this.closed++; },
      };
      detectors.push(detector);
      return detector;
    } });
  }, { context });
  await vision.link(() => {});
  await vision.evaluate();
  const module = new vm.SourceTextModule(source, {
    context, importModuleDynamically: () => vision,
  });
  await module.link(() => turntable);
  await module.evaluate();
  await flush();
  return {
    get calls() { return calls; }, timers, frames, video, streams, detectors, warnings, permission, stream,
    async retry() {
      assert.equal(timers.size, 1, 'only one pending reconnect');
      const [key, timer] = timers.entries().next().value;
      assert.equal(timer.delay, 3000);
      timers.delete(key);
      timer.callback();
      await flush();
    },
    async dispatch(type, props = {}) {
      events.dispatchEvent(Object.assign(new Event(type), props));
      await flush();
    },
  };
}

test('busy or absent camera retries until available, then starts a single tracking loop', async () => {
  const f = await fixture([failure('NotReadableError'), failure('NotFoundError')]);
  assert.equal(f.calls, 1);
  await f.retry();
  assert.equal(f.calls, 2);
  await f.retry();
  assert.equal(f.calls, 3);
  assert.equal(f.video.plays, 1);
  assert.equal(f.timers.size, 0);
  assert.equal(f.frames.size, 1);
  f.permission.dispatchEvent(new Event('change'));
  await flush();
  assert.equal(f.calls, 3, 'permission notification must not open a second session');
});

test('camera disconnection releases resources and automatically reconnects', async () => {
  const f = await fixture();
  f.streams[0].track.dispatchEvent(new Event('ended'));
  assert.equal(f.streams[0].track.stops, 1);
  assert.equal(f.detectors[0].closed, 1);
  assert.equal(f.frames.size, 0);
  assert.equal(f.video.srcObject, null);
  await f.retry();
  assert.equal(f.calls, 2);
  assert.equal(f.frames.size, 1);
  f.streams[0].track.dispatchEvent(new Event('ended'));
  assert.equal(f.timers.size, 0, 'an old track must not stop the new session');
});

test('detector failure reconnects and cancels its old frame loop', async () => {
  const f = await fixture();
  f.detectors[0].detectForVideo = () => { throw new Error('transient inference failure'); };
  const [key, frame] = f.frames.entries().next().value;
  f.frames.delete(key);
  frame(100);
  assert.equal(f.frames.size, 0);
  await f.retry();
  frame(200); // Simulate a stale callback already queued before disconnection.
  assert.equal(f.frames.size, 1);
  assert.equal(f.calls, 2);
});

test('leaving cancels retries; history restoration starts again', async () => {
  const f = await fixture([failure('NotReadableError')]);
  await f.dispatch('pagehide');
  assert.equal(f.timers.size, 0);
  f.permission.dispatchEvent(new Event('change'));
  await flush();
  assert.equal(f.calls, 1);
  await f.dispatch('pageshow', { persisted: true });
  assert.equal(f.calls, 2);
  assert.equal(f.frames.size, 1);
});

test('a camera request completing after leaving is released without a retry', async () => {
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  const f = await fixture([pending]);
  await f.dispatch('pagehide');
  const lateStream = f.stream();
  resolve(lateStream);
  await flush();
  assert.equal(lateStream.track.stops, 1);
  assert.equal(f.timers.size, 0);
  assert.equal(f.frames.size, 0);
});

test('denied camera permission does not repeat prompts; granting resumes automatically', async () => {
  const f = await fixture([failure('NotAllowedError')]);
  assert.equal(f.calls, 1);
  assert.equal(f.timers.size, 0);
  f.permission.state = 'granted';
  f.permission.dispatchEvent(new Event('change'));
  await flush();
  assert.equal(f.calls, 2);
  assert.equal(f.frames.size, 1);
});
