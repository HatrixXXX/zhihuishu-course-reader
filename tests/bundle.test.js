const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const { build } = require('../scripts/build.js');

function load(url) {
  const page = new JSDOM('<body><div id="knowledgeId-1942858164356464640"><div class="item-title">科技安全概述</div></div></body>', { url, runScripts: 'outside-only' });
  const win = page.window;
  const store = new Map();
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
