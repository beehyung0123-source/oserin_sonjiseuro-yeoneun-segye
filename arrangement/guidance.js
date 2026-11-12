(() => {
  const waiting = document.querySelector('#waiting');
  const mixer = document.querySelector('#mixer');
  const deck = mixer.querySelector('.deck-scene');
  const cursors = [...document.querySelectorAll('.hand-cursor')];
  const stemControls = [...mixer.querySelectorAll('.toggle, .volume')];
  const filterControls = [...mixer.querySelectorAll('.filter-control')];
  const dualHint = document.querySelector('#dual-hand-hint');
  const mixerHint = document.querySelector('#mixer-hint');
  const defaultMixerHint = mixerHint.textContent;

  const slots = Object.fromEntries(['waiting', 'deck', 'mix', 'filter'].map(key =>
    [key, document.getElementById(key + '-guide-slot')]));
  const guide = document.querySelector('#visitor-guide-template').content.firstElementChild.cloneNode(true);
  const title = guide.querySelector('.guide-title');
  const detail = guide.querySelector('.guide-detail');
  const demo = guide.querySelector('.gesture-demo');
  const messages = {
    raise: ['RAISE YOUR HAND TO BEGIN', '카메라 앞에서 손을 들어 보세요.'],
    start: ['PINCH TO START', 'START에 커서를 올리고 엄지와 검지를 붙이세요.', 'pinch'],
    power: ['PINCH TO POWER ON', 'POWER에 커서를 올리고 엄지와 검지를 붙이세요.', 'pinch'],
    needle: ['GRAB THE NEEDLE AND PLACE IT ON THE RECORD', '카트리지를 집고, 표시된 LP 홈까지 옮겨 손을 펴세요.'],
    carry: ['NEEDLE GRABBED', '집은 채 LP 홈으로 옮기세요.'],
    drop: ['OPEN YOUR FINGERS TO PLAY', '지금 손을 펴서 바늘을 내려놓으세요.'],
    playing: ['NOW PLAYING', '바늘이 LP 홈에 놓였습니다.'],
    mix: ['PINCH & MOVE UP OR DOWN TO MIX', '짧게 집었다 놓으면 ON/OFF · 집은 채 위아래로 움직이면 볼륨 조절', 'vertical'],
    filter: ['SHAPE THE SOUND WITH FILTERS', '선택 사항 · LPF나 HPF를 집고 위아래로 움직여 보세요.', 'vertical'],
  };

  const repeatMs = 5000;
  const visibleMs = 3300;
  let currentKey;
  let currentSlot;
  let stageSince = 0;
  let session = null;

  function show(stage, slot, now) {
    if (stage !== currentKey || slot !== currentSlot) {
      currentKey = stage;
      currentSlot = slot;
      stageSince = now;
      if (stage) {
        const [headline, instructions, motion] = messages[stage];
        title.textContent = headline;
        detail.textContent = instructions;
        demo.hidden = !motion;
        demo.dataset.demo = motion ?? '';
        slots[slot].append(guide);
        guide.dataset.stage = stage;
      }
    }

    const elapsed = now - stageSince;
    const held = stage === 'carry' || stage === 'drop' || stage === 'playing';
    const visible = Boolean(stage && (held || elapsed % repeatMs < visibleMs)
      && (stage !== 'filter' || elapsed < repeatMs * 2));
    guide.hidden = !visible;
    const guidedTarget = visible && slot !== 'waiting' ? stage : '';
    if (mixer.dataset.guideStep !== guidedTarget) mixer.dataset.guideStep = guidedTarget;
  }

  function readStems() {
    return stemControls.map(control => control.getAttribute('aria-pressed') ?? control.value).join(',');
  }

  function readFilters() {
    return filterControls.map(control => control.value).join(',');
  }

  function tick() {
    if (document.hidden) return;
    const now = performance.now();
    const hands = cursors.filter(cursor => !cursor.hidden).length;
    if (mixer.hidden) {
      session = null;
      dualHint.hidden = true;
      if (waiting.hidden) return show(null, null, now);
      const ready = canStartExperience();
      waiting.toggleAttribute('data-visitor-ready', ready);
      return show(hands ? (ready ? 'start' : null) : 'raise', 'waiting', now);
    }

    session ??= { handsSeen: false, powered: false, played: false, mixed: false,
      filtered: false, playing: false, playingUntil: 0, dualUntil: 0 };
    if (hands) session.handsSeen = true;
    if (hands === 2 && !session.dualUntil) session.dualUntil = now + 2800;
    dualHint.hidden = hands !== 2 || now >= session.dualUntil;

    mixerHint.toggleAttribute('data-guide-default', mixerHint.textContent === defaultMixerHint);
    const powered = deck.dataset.state !== 'power-off';
    const playing = mixer.classList.contains('is-playing');
    const stems = readStems();
    const filters = readFilters();
    if (powered) session.powered = true;
    if (playing && !session.playing) {
      session.played = true;
      session.playingUntil = now + 1500;
    } else if (playing && session.playing) {
      if (stems !== session.stems) session.mixed = true;
    }
    if (powered && session.filters !== undefined && filters !== session.filters) session.filtered = true;
    session.playing = playing;
    session.stems = stems;
    session.filters = filters;

    if (!session.powered) return show(session.handsSeen ? 'power' : 'raise', 'deck', now);
    if (!session.played && deck.dataset.state === 'needle-up') {
      const held = deck.hasAttribute('data-grabbed');
      return show(held ? (deck.hasAttribute('data-drop-ready') ? 'drop' : 'carry') : 'needle', 'deck', now);
    }
    if (playing && now < session.playingUntil) return show('playing', 'deck', now);
    if (playing && !session.mixed) {
      // Leave the original mix confirmation visible when it uses the footer.
      if (mixerHint.textContent !== defaultMixerHint) return show(null, null, now);
      return show('mix', 'mix', now);
    }
    if (playing && !session.filtered) return show('filter', 'filter', now);
    show(null, null, now);
  }

  setInterval(tick, 100);
  tick();
})();
