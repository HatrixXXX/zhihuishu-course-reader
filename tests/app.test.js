const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { createApp, STORAGE_KEY, LEASE_KEY } = require('../src/app.js');
const core = require('../src/core.js');
const nodeId = '1942858164356464640';
const learn = `https://ai-smart-course-student-pro.zhihuishu.com/learnPage/2101609010059079680/${nodeId}/299118?mapUid=1942422359894003712`;
const home = 'https://ai-smart-course-student-pro.zhihuishu.com/singleCourse/knowledgeStudy/2101609010059079680/299118';

function card(title, icon, done = false) {
  return `<div class="basic-info-video-card-container"><div class="icon-box ${icon}"></div><h5 class="video-title common-text">${title}</h5><div class="finished-icon">${done ? '已完成' : '0%'}</div></div>`;
}
function harness({ html = '', url = learn, store = new Map(), tabId = 'tab-a', step = () => {}, popup = true, advanceVideo = true } = {}) {
  const page = new JSDOM(`<body>${html}<div class="video-player-wrapper" style="display:none"><video></video></div></body>`, { url });
  const window = page.window;
  const document = window.document;
  const clicks = [];
  const navigations = [];
  const popups = [];
  let now = 1000;
  let playing = false;
  let time = 0;
  let ended = false;
  let app;
  const video = document.querySelector('video');
  Object.defineProperties(video, {
    paused: { get: () => !playing }, currentTime: { get: () => time },
    duration: { get: () => 2 }, ended: { get: () => ended },
    readyState: { get: () => 4 }
  });
  video.play = async () => { playing = true; };
  video.pause = () => { playing = false; };
  for (const c of document.querySelectorAll('.basic-info-video-card-container')) {
    c.querySelector('h5').addEventListener('click', () => {
      clicks.push(c.querySelector('h5').textContent);
      for (const other of document.querySelectorAll('.basic-info-video-card-container')) other.classList.remove('active');
      c.classList.add('active');
      if (c.querySelector('.icon-box.video')) {
        document.querySelector('.video-player-wrapper').style.display = '';
        video.setAttribute('src', `https://media.example/${encodeURIComponent(c.querySelector('h5').textContent)}.mp4`);
        time = 0; ended = false;
      } else {
        document.querySelector('.video-player-wrapper').style.display = 'none';
      }
      if (c.querySelector('.icon-box.zhihu') && popup) window.open('https://example.org/reading');
    });
  }
  const env = {
    window, document, pageWindow: window, tabId,
    getValue: (k, fallback) => store.has(k) ? structuredClone(store.get(k)) : fallback,
    setValue: (k, v) => store.set(k, structuredClone(v)),
    deleteValue: k => store.delete(k),
    openInTab: (url, options) => { const h = { url, options, closed: false, close() { this.closed = true; } }; popups.push(h); return h; },
    navigate: url => navigations.push(url),
    now: () => now,
    timings: { poll: 5, settle: 10, probe: 40, dwell: 20, load: 120, stall: 150, lease: 1000 },
    sleep: (ms, signal) => new Promise((resolve, reject) => setImmediate(() => {
      now += ms;
      if (signal?.aborted) return reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      if (playing && advanceVideo) { time = Math.min(2, time + 0.5); if (time === 2) { ended = true; playing = false; } }
      step({ app, window, document, now, playing, time, video });
      if (signal?.aborted) return reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      resolve();
    }))
  };
  if (!store.has(STORAGE_KEY)) store.set(STORAGE_KEY, { ...core.restoreProgress(null), chapters: [{ id: nodeId, title: '知识点一' }] });
  app = createApp(env);
  app.mount();
  return { app, env, store, window, document, clicks, navigations, popups, video, close: () => page.window.close() };
}

test('installing and mounting stays idle until the user starts', async () => {
  const h = harness({ html: card('讲义.pptx', 'other') });
  try {
    await h.app.resume();
    assert.deepEqual(h.clicks, []);
    assert.equal(h.app.getState().running, false);
    assert.ok(h.document.querySelector('#zhs-read-all-panel'));
  } finally { h.close(); }
});

test('one run opens completed documents, watches elective video, and really opens external links', async () => {
  const h = harness({ html: card('讲义.pptx', 'other', true) + card('已看视频', 'video', true) + card('选学视频', 'video') + card('外链', 'zhihu') });
  const originalOpen = h.window.open;
  try {
    await h.app.start();
    assert.deepEqual(h.clicks, ['讲义.pptx', '选学视频', '外链']);
    assert.deepEqual(Object.fromEntries(Object.values(h.app.getState().records).map(r => [r.title, r.status])), { '讲义.pptx': 'opened', '已看视频': 'platform-complete', '选学视频': 'watched', '外链': 'opened' });
    assert.equal(h.app.getState().chapterDone[nodeId], true);
    assert.equal(h.app.getState().running, false);
    assert.equal(h.popups.length, 1);
    assert.equal(h.popups[0].url, 'https://example.org/reading');
    assert.equal(h.popups[0].closed, true);
    assert.equal(h.window.open, originalOpen);
  } finally { h.close(); }
});

test('pause during a document visit neither marks it complete nor clicks the next card', async () => {
  const h = harness({ html: card('一.pptx', 'other') + card('二.pptx', 'other'), step: ({ app }) => app.pause() });
  try {
    await h.app.start();
    assert.deepEqual(h.clicks, ['一.pptx']);
    assert.deepEqual(h.app.getState().records, {});
    assert.equal(h.app.getState().running, false);
  } finally { h.close(); }
});

test('a second tab cannot acquire a live lease or stop the first tab by mounting', async () => {
  const store = new Map([[LEASE_KEY, { owner: 'tab-other', expires: 5000 }]]);
  const h = harness({ store, html: card('一.pptx', 'other') });
  try {
    await h.app.start();
    assert.deepEqual(h.clicks, []);
    assert.equal(store.get(LEASE_KEY).owner, 'tab-other');
    assert.match(h.document.querySelector('#zhs-read-all-panel').textContent, /另一个/);
  } finally { h.close(); }
});

test('an external card that never opens a destination is reported and later cards continue', async () => {
  const h = harness({ html: card('外链', 'zhihu') + card('后续讲义.pptx', 'other'), popup: false });
  try {
    await h.app.start();
    assert.deepEqual(Object.values(h.app.getState().records).map(r => r.status), ['skipped', 'opened']);
    assert.deepEqual(h.clicks, ['外链', '后续讲义.pptx']);
    assert.equal(h.app.getState().running, false);
    assert.equal(h.app.getState().chapterDone[nodeId], true);
    assert.match(h.document.querySelector('[data-report]').textContent, /外链未打开/);
  } finally { h.close(); }
});

test('unsupported resources are reported and traversal continues', async () => {
  const h = harness({ html: card('无法识别的资源', 'unknown-platform') + card('后续讲义.pptx', 'other') });
  try {
    await h.app.start();
    assert.equal(h.app.getState().running, false);
    assert.equal(h.app.getState().chapterDone[nodeId], true);
    assert.deepEqual(Object.values(h.app.getState().records).map(r => r.status), ['skipped', 'opened']);
    assert.deepEqual(h.clicks, ['无法识别的资源', '后续讲义.pptx']);
    assert.match(h.document.querySelector('[data-report]').textContent, /无法识别资源类型/);
  } finally { h.close(); }
});

test('a card that reveals a document after inspection clears its earlier deferred record', async () => {
  const h = harness({ html: card('神秘讲义', 'unknown-platform') });
  const heading = h.document.querySelector('h5');
  heading.addEventListener('click', () => {
    const cardElement = heading.closest('.basic-info-video-card-container');
    cardElement.querySelector('.icon-box').className = 'icon-box other';
    if (!cardElement.querySelector('.page-num')) cardElement.insertAdjacentHTML('beforeend', '<div class="page-num">2页</div>');
  });
  try {
    await h.app.start();
    assert.deepEqual(Object.values(h.app.getState().records).map(r => r.status), ['opened']);
    assert.equal(core.progressReport(h.app.getState()).skipped.length, 0);
    assert.equal(h.app.getState().chapterDone[nodeId], true);
  } finally { h.close(); }
});

test('known CNKI resource is skipped, later resources continue, and final report links back to the chapter', async () => {
  const h = harness({ html: card('颠覆性技术与科技安全', 'unknown-platform') +
    card('军民融合型科技工业协同创新体系构建研究——基于国际比较视角', 'unknown-platform') + card('后续讲义.pptx', 'other') });
  try {
    await h.app.start();
    assert.deepEqual(h.clicks, ['后续讲义.pptx']);
    assert.deepEqual(Object.values(h.app.getState().records).map(r => r.status), ['skipped', 'skipped', 'opened']);
    assert.equal(h.app.getState().phase, 'finished');
    assert.equal(h.app.getState().chapterDone[nodeId], true);
    const report = h.document.querySelector('[data-report]');
    assert.equal(report.hidden, false);
    assert.match(report.textContent, /颠覆性技术与科技安全/);
    assert.match(report.textContent, /军民融合型科技工业协同创新体系构建研究/);
    assert.equal(report.querySelectorAll('li').length, 2);
    assert.equal(report.querySelector('a').href, learn);
  } finally { h.close(); }
});

test('dynamic CNKI destinations are deferred without opening tabs while ordinary links still open', async () => {
  const h = harness({ html: card('动态知网资料', 'unknown-platform') + card('知网外链', 'link') + card('普通外链', 'zhihu') });
  const headings = h.document.querySelectorAll('.basic-info-video-card-container h5');
  headings[0].addEventListener('click', () => {
    h.document.querySelector('.basic-info-video-card-container .icon-box').className = 'icon-box link';
    h.window.open('https://kns.cnki.net/kcms/detail/2');
  });
  headings[1].addEventListener('click', () => h.window.open('http://www.cnki.net/article'));
  try {
    await h.app.start();
    assert.deepEqual(h.clicks, ['动态知网资料', '知网外链', '普通外链']);
    assert.deepEqual(Object.values(h.app.getState().records).map(r => r.status), ['skipped', 'skipped', 'opened']);
    assert.equal(h.app.getState().chapterDone[nodeId], true);
    assert.deepEqual(h.popups.map(p => p.url), ['https://example.org/reading']);
    const links = [...h.document.querySelectorAll('[data-report] a')].map(a => a.href);
    assert.ok(links.includes('https://kns.cnki.net/kcms/detail/2'));
    assert.ok(links.includes('http://www.cnki.net/article'));
  } finally { h.close(); }
});

test('an unrelated unknown card stops media started during link inspection and is deferred', async () => {
  const h = harness({ html: card('未标注的视频', 'unknown-platform') });
  h.document.querySelector('h5').addEventListener('click', () => {
    h.document.querySelector('.video-player-wrapper').style.display = '';
    h.video.setAttribute('src', 'https://media.example/unknown.mp4');
    h.video.play();
  });
  try {
    await h.app.start();
    assert.deepEqual(Object.values(h.app.getState().records).map(r => r.status), ['skipped']);
    assert.equal(h.video.paused, true);
    assert.equal(h.app.getState().chapterDone[nodeId], true);
  } finally { h.close(); }
});

test('a CNKI popup scheduled after the initial settle delay is still deferred', async () => {
  let launched = false;
  const h = harness({
    html: card('延迟打开的知网资料', 'unknown-platform'),
    step: ({ now, window }) => {
      if (!launched && now >= 1020) { launched = true; window.open('https://kns.cnki.net/kcms/detail/4'); }
    },
  });
  try {
    await h.app.start();
    assert.equal(launched, true);
    assert.deepEqual(Object.values(h.app.getState().records).map(r => r.status), ['skipped']);
    assert.deepEqual(h.popups, []);
  } finally { h.close(); }
});

test('an unlabelled Bilibili link opens once and traversal continues', async () => {
  const title = '比芯片更可悲的行业，制造业命脉受制于人，国产CAE软件开始突围！';
  const h = harness({ html: card(title, 'unknown-platform') + card('后续讲义.pptx', 'other') });
  h.document.querySelector('h5').addEventListener('click', () => {
    h.document.querySelector('.basic-info-video-card-container .icon-box').className = 'icon-box link';
    h.window.open('https://www.bilibili.com/video/BV1example');
  });
  try {
    await h.app.start();
    assert.deepEqual(h.clicks, [title, '后续讲义.pptx']);
    assert.deepEqual(Object.values(h.app.getState().records).map(r => r.status), ['opened', 'opened']);
    assert.equal(h.app.getState().chapterDone[nodeId], true);
    assert.deepEqual(h.popups.map(p => p.url), ['https://www.bilibili.com/video/BV1example']);
    assert.equal(h.popups[0].closed, true);
    const resumed = harness({ store: h.store, html: card(title, 'link') + card('后续讲义.pptx', 'other') });
    try {
      await resumed.app.start();
      assert.deepEqual(resumed.clicks, []);
    } finally { resumed.close(); }
  } finally { h.close(); }
});

test('an ordinary external popup scheduled after the first wait is opened once', async () => {
  let launched = false;
  const h = harness({
    html: card('稍后打开的外链', 'unknown-platform'),
    step: ({ now, window }) => {
      if (!launched && now >= 1020) { launched = true; window.open('https://www.bilibili.com/video/BV1delayed'); }
    },
  });
  try {
    await h.app.start();
    assert.equal(launched, true);
    assert.deepEqual(Object.values(h.app.getState().records).map(r => r.status), ['opened']);
    assert.deepEqual(h.popups.map(p => p.url), ['https://www.bilibili.com/video/BV1delayed']);
    assert.equal(h.popups[0].closed, true);
  } finally { h.close(); }
});

test('unknown cards cannot turn blank, relative, or course URLs into successful external visits', async () => {
  for (const target of [undefined, '', '/some-path', learn]) {
    const h = harness({ html: card('无有效外链', 'unknown-platform') });
    h.document.querySelector('h5').addEventListener('click', () => h.window.open(target));
    try {
      await h.app.start();
      assert.deepEqual(Object.values(h.app.getState().records).map(r => r.status), ['skipped'], String(target));
      assert.equal(h.app.getState().chapterDone[nodeId], true, String(target));
      assert.deepEqual(h.popups, [], String(target));
    } finally { h.close(); }
  }
});

test('persisted resume continues in the same tab without reopening visited documents', async () => {
  const store = new Map();
  const h = harness({ store, html: card('一.pptx', 'other') + card('二.pptx', 'other') });
  try {
    const state = core.restoreProgress(store.get(STORAGE_KEY));
    state.records[core.resourceKey(nodeId, { id: 'document:%E4%B8%80.pptx:1' })] = { status: 'opened' };
    state.running = true; state.owner = 'tab-a'; state.currentNodeId = nodeId;
    store.set(STORAGE_KEY, state);
    h.close();
    const resumed = harness({ store, html: card('一.pptx', 'other') + card('二.pptx', 'other') });
    try {
      await resumed.app.resume();
      assert.deepEqual(resumed.clicks, ['二.pptx']);
    } finally { resumed.close(); }
  } finally { /* Previous document was closed before simulating refresh. */ }
});

test('catalog scanning includes 100 percent nodes and both modules', async () => {
  const html = `<div id="knowledgeId-1942858164356464640"><div class="item-mask"></div><div class="item-title">已到100%</div></div><div id="knowledgeId-1959274810743853056"><div class="item-mask"></div><div class="item-title">第二模块</div></div>`;
  const h = harness({ html, url: home });
  let entered = false;
  h.document.querySelector('.item-mask').addEventListener('click', () => { entered = true; h.app.pause(); });
  try {
    await h.app.start();
    assert.deepEqual(h.app.getState().chapters.map(c => c.id), ['1942858164356464640', '1959274810743853056']);
    assert.equal(entered, true);
  } finally { h.close(); }
});

test('a visible dialog on the catalog still allows scanning and direct navigation to the first node', async () => {
  const html = `<div role="dialog">请完成验证码</div><div id="knowledgeId-${nodeId}"><div class="item-title">知识点一</div></div>`;
  const h = harness({ html, url: home });
  try {
    await h.app.start();
    assert.deepEqual(h.app.getState().chapters.map(c => c.id), [nodeId]);
    assert.equal(h.navigations.length, 1);
    assert.equal(new URL(h.navigations[0]).pathname, `/learnPage/2101609010059079680/${nodeId}/299118`);
    assert.equal(h.app.getState().running, true);
  } finally { h.close(); }
});

test('wrong course creates no controls and cannot execute clicks', async () => {
  const h = harness({ html: card('一.pptx', 'other'), url: home.replace('299118', '299119') });
  try {
    await h.app.start();
    assert.deepEqual(h.clicks, []);
    assert.equal(h.document.querySelector('#zhs-read-all-panel'), null);
  } finally { h.close(); }
});

test('login or quiz dialog defers affected resources without clicking them', async () => {
  const h = harness({ html: `<div role="dialog">请完成验证码</div>${card('一.pptx', 'other')}${card('二.pptx', 'other')}` });
  try {
    await h.app.start();
    assert.deepEqual(h.clicks, []);
    assert.deepEqual(Object.values(h.app.getState().records).map(r => r.status), ['skipped', 'skipped']);
    assert.equal(h.app.getState().chapterDone[nodeId], true);
    assert.match(h.document.querySelector('[data-report]').textContent, /验证或答题弹窗/);
  } finally { h.close(); }
});

test('a completed chapter advances to the next node while preserving the real route context', async () => {
  const h = harness({ html: card('一.pptx', 'other') });
  try {
    const state = h.app.getState();
    state.chapters.push({ id: '1959274810743853056', title: '第二模块' });
    h.store.set(STORAGE_KEY, structuredClone(state));
    await h.app.start();
    assert.equal(h.navigations.length, 1);
    const target = new URL(h.navigations[0]);
    assert.equal(target.pathname, '/learnPage/2101609010059079680/1959274810743853056/299118');
    assert.equal(target.searchParams.get('mapUid'), '1942422359894003712');
    assert.equal(h.store.get(STORAGE_KEY).running, true);
  } finally { h.close(); }
});

test('consecutive videos work when the platform reuses the same HTML video element', async () => {
  const h = harness({ html: card('第一视频', 'video') + card('第二视频', 'video') });
  try {
    await h.app.start();
    assert.deepEqual(h.clicks, ['第一视频', '第二视频']);
    assert.deepEqual(Object.values(h.app.getState().records).map(r => r.status), ['watched', 'watched']);
  } finally { h.close(); }
});

test('a stale visible player cannot mark a different resource as watched', async () => {
  const h = harness({ html: card('第一视频', 'video') + card('第二视频', 'video') });
  h.document.querySelectorAll('h5')[1].addEventListener('click', () => {
    h.video.setAttribute('src', 'https://media.example/%E7%AC%AC%E4%B8%80%E8%A7%86%E9%A2%91.mp4');
  });
  try {
    await h.app.start();
    assert.deepEqual(Object.values(h.app.getState().records).map(r => r.status), ['watched', 'skipped']);
    assert.equal(h.app.getState().chapterDone[nodeId], true);
    assert.match(h.document.querySelector('[data-report]').textContent, /未加载|未切换/);
  } finally { h.close(); }
});

test('a video that cannot start is deferred while later resources continue', async () => {
  const h = harness({ html: card('受阻视频', 'video') + card('后续讲义.pptx', 'other') });
  h.video.play = () => Promise.reject(new Error('autoplay blocked'));
  try {
    await h.app.start();
    assert.deepEqual(Object.values(h.app.getState().records).map(r => r.status), ['skipped', 'opened']);
    assert.deepEqual(h.clicks, ['受阻视频', '后续讲义.pptx']);
    assert.equal(h.app.getState().chapterDone[nodeId], true);
    assert.match(h.document.querySelector('[data-report]').textContent, /自动播放/);
  } finally { h.close(); }
});

test('a chapter with no loadable resource list is reported and traversal finishes', async () => {
  const h = harness({ html: '' });
  try {
    await h.app.start();
    assert.deepEqual(Object.values(h.app.getState().records).map(r => r.status), ['skipped']);
    assert.equal(h.app.getState().chapterDone[nodeId], true);
    assert.match(h.document.querySelector('[data-report]').textContent, /资源卡片/);
  } finally { h.close(); }
});

test('a stalled video is deferred without blocking the following document', async () => {
  const h = harness({ html: card('停滞视频', 'video') + card('后续讲义.pptx', 'other'), advanceVideo: false });
  try {
    await h.app.start();
    assert.deepEqual(Object.values(h.app.getState().records).map(r => r.status), ['skipped', 'opened']);
    assert.equal(h.video.paused, true);
    assert.equal(h.app.getState().chapterDone[nodeId], true);
    assert.match(h.document.querySelector('[data-report]').textContent, /没有播放进展/);
  } finally { h.close(); }
});

test('a video later marked complete by the platform clears its deferred status', async () => {
  const h = harness({ html: card('已完成视频', 'video', true) });
  const state = h.app.getState();
  const resource = { id: `video:${encodeURIComponent('已完成视频')}:1` };
  state.records[core.resourceKey(nodeId, resource)] = { title: '已完成视频', kind: 'video', status: 'skipped', nodeId, index: 0, reason: '上次播放失败' };
  h.store.set(STORAGE_KEY, structuredClone(state));
  try {
    await h.app.start();
    assert.deepEqual(Object.values(h.app.getState().records).map(r => r.status), ['platform-complete']);
    assert.equal(core.progressReport(h.app.getState()).skipped.length, 0);
  } finally { h.close(); }
});

test('a deferred resource still advances to the next knowledge point', async () => {
  const h = harness({ html: card('无法识别的资源', 'unknown-platform') });
  const state = h.app.getState();
  state.chapters.push({ id: '1959274810743853056', title: '下一知识点' });
  h.store.set(STORAGE_KEY, structuredClone(state));
  try {
    await h.app.start();
    assert.deepEqual(Object.values(h.app.getState().records).map(r => r.status), ['skipped']);
    assert.equal(h.app.getState().chapterDone[nodeId], true);
    assert.equal(h.navigations.length, 1);
    assert.equal(h.app.getState().running, true);
  } finally { h.close(); }
});

test('losing the lease pauses locally without overwriting the new runner progress', async () => {
  const store = new Map();
  let moved = false;
  const h = harness({ store, html: card('一.pptx', 'other'), step: () => {
    if (moved) return;
    moved = true;
    store.set(LEASE_KEY, { owner: 'tab-b', expires: 99999 });
    store.set(STORAGE_KEY, { ...core.restoreProgress(store.get(STORAGE_KEY)), owner: 'tab-b', running: true });
  } });
  try {
    await h.app.start();
    assert.equal(store.get(STORAGE_KEY).owner, 'tab-b');
    assert.equal(store.get(STORAGE_KEY).running, true);
    assert.equal(h.app.getState().running, false);
  } finally { h.close(); }
});

test('an older mounted tab reloads newer progress even when the previous owner is unchanged', async () => {
  const seed = { ...core.restoreProgress(null), chapters: [{ id: nodeId, title: '知识点一' }], owner: 'tab-a' };
  const store = new Map([[STORAGE_KEY, seed]]);
  const h = harness({ store, tabId: 'tab-b', html: card('一.pptx', 'other') + card('二.pptx', 'other') });
  try {
    const updated = structuredClone(seed);
    updated.records[core.resourceKey(nodeId, { id: 'document:%E4%B8%80.pptx:1' })] = { status: 'opened' };
    updated.records['another chapter video'] = { status: 'watched' };
    store.set(STORAGE_KEY, updated);
    await h.app.start();
    assert.deepEqual(h.clicks, ['二.pptx']);
    assert.equal(store.get(STORAGE_KEY).records['another chapter video'].status, 'watched');
  } finally { h.close(); }
});

test('switching a document during dwell cannot count the previous document as opened', async () => {
  let switched = false;
  const h = harness({ html: card('一.pptx', 'other') + card('二.pptx', 'other'), step: ({ now, document }) => {
    if (now <= 1010 || switched) return;
    switched = true;
    const cards = document.querySelectorAll('.basic-info-video-card-container');
    cards[0].classList.remove('active'); cards[1].classList.add('active');
  } });
  try {
    await h.app.start();
    assert.deepEqual(Object.values(h.app.getState().records).map(r => r.status), ['skipped', 'opened']);
    assert.equal(h.app.getState().chapterDone[nodeId], true);
  } finally { h.close(); }
});

test('a visible preview error defers the document without counting it as opened', async () => {
  const h = harness({ html: card('一.pptx', 'other') + '<div class="document-preview"><div role="alert">文档加载失败，请重试</div></div>' });
  try {
    await h.app.start();
    assert.deepEqual(Object.values(h.app.getState().records).map(r => r.status), ['skipped']);
    assert.equal(h.app.getState().chapterDone[nodeId], true);
    assert.match(h.document.querySelector('[data-report]').textContent, /加载失败/);
  } finally { h.close(); }
});

test('a loading mask in a hidden preview does not block the active document', async () => {
  const h = harness({ html: card('一.pptx', 'other') + '<div hidden><div class="el-loading-mask"></div></div>' });
  try {
    await h.app.start();
    assert.equal(h.app.getState().chapterDone[nodeId], true);
  } finally { h.close(); }
});

test('pause cancels playback startup even when native play returns a pending promise', async () => {
  const h = harness({ html: card('视频', 'video') });
  let requested = false;
  h.video.play = () => { requested = true; return new Promise(() => {}); };
  try {
    const running = h.app.start();
    for (let i = 0; i < 5 && !requested; i++) await new Promise(resolve => setImmediate(resolve));
    assert.equal(requested, true);
    h.app.pause();
    let timeout;
    try {
      await Promise.race([running, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Pause did not cancel the pending playback startup')), 200); })]);
    } finally { clearTimeout(timeout); }
    assert.deepEqual(h.app.getState().records, {});
    assert.equal(h.app.getState().running, false);
  } finally { h.close(); }
});
