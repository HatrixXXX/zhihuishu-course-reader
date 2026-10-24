const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { JSDOM } = require('jsdom');

const dom = require('../src/dom.js');
const course = '2101609010059079680';
const host = 'https://ai-smart-course-student-pro.zhihuishu.com';

function page(html = '') {
  return new JSDOM(html, { url: `${host}/learnPage/${course}/1942858164356464640/299118` }).window.document;
}

function card({ title, icon = 'video', badge = '0%', active = false, detail = '', extra = '' }) {
  return `<div class="basic-info-video-card-container${active ? ' active' : ''}">
    <div class="icon-box ${icon}"></div>
    <div class="video-title common-text"><h5>${title}</h5></div>
    <div class="page-num">${detail}</div><span class="finished-icon">${badge}</span>${extra}
  </div>`;
}

test('readPage preserves large course and node IDs as strings', () => {
  assert.deepEqual(dom.readPage(`${host}/singleCourse/knowledgeStudy/${course}/299118?tab=all`), {
    page: 'catalog', courseId: course, classId: '299118', nodeId: null,
  });
  assert.deepEqual(dom.readPage(`${host}/learnPage/${course}/1942858164356464640/299118?x=1`), {
    page: 'learn', courseId: course, classId: '299118', nodeId: '1942858164356464640',
  });
});

test('readPage rejects another host, course, class, or route', () => {
  for (const url of [
    `https://ai-smart-course-student-pro.zhihuishu.com.evil.example/learnPage/${course}/1/299118`,
    `${host}/learnPage/2101609010059079681/1/299118`,
    `${host}/learnPage/${course}/1/299119`,
    `${host}/learnPage/${course}/1/299118/extra`,
    `${host}/learnPage/${course}/not-a-node/299118`,
    `${host}/somewhere?courseId=${course}&classId=299118`,
    'not a URL',
  ]) assert.equal(dom.readPage(url), null, url);
});

test('readCatalog includes both modules and ignores chapter learning percentages', () => {
  const nodes = Array.from({ length: 25 }, (_, index) => {
    const id = String(1942858164356464640n + BigInt(index));
    return `<div class="item-content" knowledgeid="${id}" id="knowledgeId-${id}">
      <div class="item-mask"></div><div class="item-title" title="知识点${index + 1}">知识点${index + 1}</div>
      <span class="progress-num">100%</span></div>`;
  });
  const document = page(`<section>${nodes.slice(0, 20).join('')}</section><section hidden>${nodes.slice(20).join('')}</section>`);
  const result = dom.readCatalog(document);
  assert.equal(result.length, 25);
  assert.equal(result[0].id, '1942858164356464640');
  assert.equal(result[24].id, '1942858164356464664');
  assert.equal(result[24].title, '知识点25');
  assert.equal(result[0].element, document.querySelector('.item-content'));
});

test('readCatalog skips malformed IDs and deduplicates the same knowledge node', () => {
  const document = page(`<div id="knowledgeId-1942858164356464640"><span class="item-title">科技安全概述</span></div>
    <div knowledgeid="1942858164356464640"><span class="item-title">重复节点</span></div>
    <div knowledgeid="invalid"><span class="item-title">无效节点</span></div>`);
  assert.deepEqual(dom.readCatalog(document).map(({ id, title }) => ({ id, title })), [
    { id: '1942858164356464640', title: '科技安全概述' },
  ]);
});

test('readResources includes all required and elective cards once in DOM order', () => {
  const document = page(`<section class="resources-list"><div class="resources-list-box">
    ${card({ title: '必修视频', detail: '00:04:11', badge: '已完成', active: true })}
    ${card({ title: '重点领域安全五.pptx', icon: 'other', detail: '114页' })}
    </div></section><section class="resources-list"><div class="resources-list-box">
    ${card({ title: '选修文章', icon: 'zhihu' })}</div></section>`);
  const result = dom.readResources(document);
  assert.deepEqual(result.map(({ title, kind, completed, active, index }) => ({ title, kind, completed, active, index })), [
    { title: '必修视频', kind: 'video', completed: true, active: true, index: 0 },
    { title: '重点领域安全五.pptx', kind: 'document', completed: false, active: false, index: 1 },
    { title: '选修文章', kind: 'link', completed: false, active: false, index: 2 },
  ]);
  assert.equal(result[0].element, document.querySelector('.basic-info-video-card-container'));
  assert.equal(result[0].clickTarget, document.querySelector('.video-title.common-text'));
});

test('readResources uses clear type evidence and keeps unrecognized cards unknown', () => {
  const document = page([
    card({ title: '课程讲义.PDF', icon: 'mystery' }),
    card({ title: '补充材料', icon: 'other', detail: '2页' }),
    card({ title: '说明', icon: 'text' }),
    card({ title: '资料链接', icon: 'mystery', extra: '<a href="https://example.org/article">打开</a>' }),
    card({ title: '待识别材料', icon: 'other', extra: '<a href="javascript:void(0)">打开</a>' }),
  ].join(''));
  assert.deepEqual(dom.readResources(document).map(resource => resource.kind), ['document', 'document', 'text', 'link', 'unknown']);
});

test('resource IDs distinguish duplicate titles and remain stable across badge changes', () => {
  const document = page(card({ title: '相同 标题' }) + card({ title: '相同 标题' }) + card({ title: '相同 标题', icon: 'zhihu' }));
  const before = dom.readResources(document);
  assert.equal(new Set(before.map(resource => resource.id)).size, 3);
  document.querySelectorAll('.finished-icon').forEach(badge => { badge.textContent = '已完成'; });
  assert.deepEqual(dom.readResources(document).map(resource => resource.id), before.map(resource => resource.id));
});

test('a malformed card without a title keeps its identity when a badge changes', () => {
  const document = page('<div class="basic-info-video-card-container"><div class="icon-box mystery"></div><span class="finished-icon">0%</span></div>');
  const before = dom.readResources(document)[0];
  assert.equal(before.title, '');
  assert.equal(before.kind, 'unknown');
  document.querySelector('.finished-icon').textContent = '已完成';
  assert.equal(dom.readResources(document)[0].id, before.id);
});

test('a zero-percent or hidden badge cannot mark a resource complete', () => {
  const document = page(card({ title: '未完成', badge: '0%' }) + card({ title: '已完成', badge: '100%' }) + card({ title: '隐藏标记', badge: '已完成' }));
  document.querySelectorAll('.finished-icon')[2].hidden = true;
  assert.deepEqual(dom.readResources(document).map(resource => resource.completed), [false, true, false]);
});

test('isResourceSelected observes current selection after clicks and rerendering', () => {
  const document = page(card({ title: '第一个', active: true }) + card({ title: '第二个' }));
  const resources = dom.readResources(document);
  resources[1].clickTarget.addEventListener('click', () => {
    resources[0].element.classList.remove('active');
    resources[1].element.classList.add('active');
  });
  resources[1].clickTarget.click();
  assert.equal(dom.isResourceSelected(resources[0], document), false);
  assert.equal(dom.isResourceSelected(resources[1], document), true);
  document.body.innerHTML = card({ title: '第一个', active: true }) + card({ title: '第二个' });
  assert.equal(dom.isResourceSelected(resources[1], document), false);
  assert.equal(dom.isResourceSelected(resources[0], document), true);
});

test('findMedia uses the visible current wrapper and rejects hidden stale media', () => {
  const document = page(`<video id="outside"></video><div class="video-player-wrapper" hidden><video id="old"></video></div>
    <div class="video-player-wrapper"><div style="display:none"><video id="nested-old"></video></div><video id="current"></video></div>`);
  assert.equal(dom.findMedia(document), document.querySelector('#current'));
  document.querySelector('#current').style.visibility = 'hidden';
  assert.equal(dom.findMedia(document), null);
});

test('findMedia can use a visible native player when no wrapper exists', () => {
  const document = page('<div aria-hidden="true"><video></video></div><audio id="current"></audio>');
  assert.equal(dom.findMedia(document), document.querySelector('#current'));
});

test('findMedia inspects accessible visible frames without assuming cross-origin access', () => {
  const document = page('<div class="video-player-wrapper"><iframe id="blocked"></iframe><iframe id="hidden" hidden></iframe><iframe id="same"></iframe></div>');
  Object.defineProperty(document.querySelector('#blocked'), 'contentDocument', {
    get() { throw new document.defaultView.DOMException('Blocked by same-origin policy', 'SecurityError'); },
  });
  document.querySelector('#hidden').contentDocument.body.innerHTML = '<video id="stale"></video>';
  const frameDocument = document.querySelector('#same').contentDocument;
  frameDocument.body.innerHTML = '<video id="current"></video>';
  assert.equal(dom.findMedia(document), frameDocument.querySelector('#current'));
  document.querySelector('#same').hidden = true;
  assert.equal(dom.findMedia(document), null);
});

test('hasBlockingDialog recognizes visible quiz, captcha, and login gates', () => {
  for (const html of [
    '<div class="question-dialog">请选择正确答案</div>',
    '<div role="dialog">请完成滑块验证</div>',
    '<div class="login-modal">登录已过期</div>',
    '<div class="el-dialog">请先完成答题后继续播放</div>',
  ]) assert.equal(dom.hasBlockingDialog(page(html)), true, html);
});

test('hasBlockingDialog ignores hidden gates, document previews, and AI sidebar text', () => {
  const document = page(`<div class="question-dialog" hidden>视频问题</div>
    <div style="display: none"><div class="captcha">验证码</div></div>
    <aside class="ai-chatbot"><div role="dialog">请回答以下问题，登录后可保存答题记录</div></aside>
    <div class="el-dialog">课程讲义预览</div><main>请先登录，才能答题</main>`);
  assert.equal(dom.hasBlockingDialog(document), false);
});

test('browser export exposes the adapter without a CommonJS module', () => {
  const window = new JSDOM('', { runScripts: 'outside-only' }).window;
  window.eval(fs.readFileSync(path.join(__dirname, '../src/dom.js'), 'utf8'));
  assert.equal(typeof window.ZHSReadAll.dom.readResources, 'function');
  assert.equal(window.ZHSReadAll.dom.readPage(`${host}/learnPage/${course}/1942858164356464640/299118`).nodeId, '1942858164356464640');
  window.close();
});
