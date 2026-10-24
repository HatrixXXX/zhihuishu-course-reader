const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const { build } = require('../scripts/build.js');
const core = require('../src/core.js');
const { STORAGE_KEY, LEASE_KEY } = require('../src/app.js');

function load(url, { html = '<div id="knowledgeId-1942858164356464640"><div class="item-title">科技安全概述</div></div>', store = new Map(), fastTimers = false } = {}) {
  const page = new JSDOM(`<body>${html}</body>`, { url, runScripts: 'outside-only' });
  const win = page.window;
  if (fastTimers) {
    let now = 1000;
    const schedule = win.setTimeout.bind(win);
    win.Date.now = () => now;
    win.setTimeout = (callback, delay, ...args) => schedule(() => { now += Number(delay) || 0; callback(...args); }, 0);
  }
  for (const card of win.document.querySelectorAll('.basic-info-video-card-container')) {
    card.querySelector('h5').addEventListener('click', () => card.classList.add('active'));
  }
  win.GM_getTab = callback => callback({});
  win.GM_saveTab = () => {};
  win.GM_getValue = (key, fallback) => store.get(key) ?? fallback;
  win.GM_setValue = (key, value) => store.set(key, value);
  win.GM_deleteValue = key => store.delete(key);
  win.GM_openInTab = () => { throw new Error('Cold installation must not open a tab'); };
  win.unsafeWindow = win;
  win.eval(fs.readFileSync(build(), 'utf8'));
  return page;
}

test('the built userscript boots in a real DOM without require or runtime dependencies', async () => {
  const page = load('https://ai-smart-course-student-pro.zhihuishu.com/singleCourse/knowledgeStudy/2101609010059079680/299118');
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(page.window.document.querySelector('#zhs-read-all-panel'));
    assert.equal(page.window.ZHSReadAll.instance.getState().running, false);
  } finally { page.window.close(); }
});

test('the complete installable artifact stays inert on another course', async () => {
  const page = load('https://ai-smart-course-student-pro.zhihuishu.com/singleCourse/knowledgeStudy/2101609010059079681/299118');
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(page.window.document.querySelector('#zhs-read-all-panel'), null);
    assert.equal(page.window.ZHSReadAll.instance, undefined);
  } finally { page.window.close(); }
});

test('the installed bundle automatically continues on a fresh next-page document', async () => {
  const nodeId = '1942858169804865536';
  const url = `https://${core.HOST}/learnPage/${core.COURSE}/${nodeId}/${core.CLASS}?catalogActiveTab=personal`;
  const store = new Map([[STORAGE_KEY, {
    ...core.restoreProgress(null), running: true, owner: 'old-page', phase: 'learn', currentNodeId: nodeId,
    chapters: [{ id: nodeId, title: '下一知识点' }],
    navigation: { owner: 'old-page', url, expires: 301000 },
  }], [LEASE_KEY, { owner: 'old-page', expires: 16000 }]]);
  const page = load(url, { store, fastTimers: true, html: '<div class="basic-info-video-card-container"><h5 class="video-title">新页面讲义.pptx</h5></div>' });
  try {
    for (let i = 0; i < 100 && store.get(STORAGE_KEY).phase !== 'finished'; i++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.ok(page.window.document.querySelector('#zhs-read-all-panel'));
    assert.equal(store.get(STORAGE_KEY).phase, 'finished');
    assert.deepEqual(Object.values(store.get(STORAGE_KEY).records).map(r => r.status), ['opened']);
    assert.notEqual(store.get(STORAGE_KEY).owner, 'old-page');
  } finally { page.window.close(); }
});
