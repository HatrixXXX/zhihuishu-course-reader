const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../src/core.js');
const home = 'https://ai-smart-course-student-pro.zhihuishu.com/singleCourse/knowledgeStudy/2101609010059079680/299118';

test('course scope keeps large IDs as strings and rejects other courses and hosts', () => {
  assert.deepEqual(core.parseScope(home), { page: 'catalog', courseId: '2101609010059079680', classId: '299118', nodeId: null });
  assert.equal(core.parseScope(home.replace('/299118', '/299119')), null);
  assert.equal(core.parseScope(home.replace('2101609010059079680', '2101609010059079681')), null);
  assert.equal(core.parseScope(home.replace('.zhihuishu.com', '.zhihuishu.com.evil.test')), null);
  assert.equal(core.parseScope(home.replace('https:', 'http:')), null);
  assert.equal(core.parseScope('not a URL'), null);
});

test('records distinguish the same resource in different knowledge points', () => {
  const r = { id: 'document:ppt:1' };
  assert.notEqual(core.resourceKey('1942858164356464640', r), core.resourceKey('1942858165635727360', r));
});

test('queue visits completed documents and elective links and skips verified complete videos', () => {
  const list = [
    { id: 'ppt', title: 'shared.pptx', kind: 'document', completed: true },
    { id: 'v1', title: 'video', kind: 'video', completed: true },
    { id: 'elective', title: 'link', kind: 'link', completed: false },
  ];
  const records = {};
  assert.equal(core.nextResource('node', list, records).id, 'ppt');
  records[core.resourceKey('node', list[0])] = { status: 'opened' };
  assert.equal(core.nextResource('node', list, records).id, 'elective');
  records[core.resourceKey('node', list[2])] = { status: 'error' };
  assert.equal(core.nextResource('node', list, records).id, 'elective');
  records[core.resourceKey('node', list[2])] = { status: 'opened' };
  assert.equal(core.nextResource('node', list, records), null);
});

test('opened is insufficient for video completion and unknown resources are not skipped', () => {
  const video = { id: 'v', kind: 'video', completed: false };
  const records = { [core.resourceKey('n', video)]: { status: 'opened' } };
  assert.equal(core.nextResource('n', [video], records), video);
  assert.equal(core.nextResource('n', [{ id: 'x', kind: 'unknown' }], {} ).id, 'x');
});

test('manual resources stay skipped after restoring progress and appear in the report', () => {
  const resource = { id: 'manual:cnki:1', kind: 'manual' };
  const nodeId = '1942858164356464640';
  const state = {
    ...core.restoreProgress(null), phase: 'finished',
    chapters: [{ id: nodeId, title: '科技安全' }],
    records: { [core.resourceKey(nodeId, resource)]: {
      title: '颠覆性技术与科技安全', kind: 'manual', status: 'skipped', nodeId,
      url: 'https://kns.cnki.net/kcms/detail/1', mapUid: '1942422359894003712',
    } },
  };
  const restored = core.restoreProgress(state);
  assert.equal(restored.phase, 'finished');
  assert.equal(core.nextResource(nodeId, [resource], restored.records), null);
  assert.deepEqual(core.progressReport(restored).skipped, [{
    title: '颠覆性技术与科技安全', chapterTitle: '科技安全',
    courseUrl: `https://ai-smart-course-student-pro.zhihuishu.com/learnPage/2101609010059079680/${nodeId}/299118?mapUid=1942422359894003712`,
    url: 'https://kns.cnki.net/kcms/detail/1', reason: null,
  }]);
});

test('a confirmed dynamic CNKI skip remains done even when its card icon is unknown', () => {
  const resource = { id: 'unknown:cnki:1', kind: 'unknown', title: '同一知网资料', index: 0 };
  const nodeId = '1942858164356464640';
  const records = { [core.resourceKey(nodeId, resource)]: { status: 'skipped', kind: 'unknown', url: 'https://kns.cnki.net/kcms/detail/2', nodeId, title: resource.title, index: resource.index } };
  assert.equal(core.nextResource(nodeId, [resource], records), null);
  assert.equal(core.nextResource(nodeId, [{ ...resource, id: 'link:cnki:1', kind: 'link' }], records), null);
  assert.equal(core.nextResource(nodeId, [{ ...resource, id: 'link:cnki:1', kind: 'link', index: 1 }], records).index, 1);
});

test('a generic failed card is retried when the platform reveals a supported type', () => {
  const nodeId = '1942858164356464640';
  const unknown = { id: 'unknown:item:1', kind: 'unknown', title: '资料', index: 0 };
  const document = { ...unknown, id: 'document:item:1', kind: 'document' };
  const records = { [core.resourceKey(nodeId, unknown)]: { status: 'skipped', kind: 'unknown', title: '资料', index: 0, nodeId, reason: '无法识别资源类型' } };
  assert.equal(core.nextResource(nodeId, [document], records), document);
});

test('an unknown card is complete only after a real external link was opened', () => {
  const nodeId = '1942858164356464640';
  const resource = { id: 'unknown:bilibili:1', kind: 'unknown', title: '比芯片更可悲的行业', index: 0 };
  const key = core.resourceKey(nodeId, resource);
  assert.equal(core.nextResource(nodeId, [resource], { [key]: { status: 'opened' } }), resource);
  const records = { [key]: { status: 'opened', kind: 'link', url: 'https://www.bilibili.com/video/BV1test', nodeId, title: resource.title, index: 0 } };
  assert.equal(core.nextResource(nodeId, [resource], records), null);
  assert.equal(core.nextResource(nodeId, [{ ...resource, id: 'link:bilibili:1', kind: 'link' }], records), null);
  assert.equal(core.nextResource(nodeId, [{ ...resource, id: 'link:bilibili:1', kind: 'link', index: 1 }], records).index, 1);
  assert.equal(core.nextResource(nodeId, [{ ...resource, id: 'video:bilibili:1', kind: 'video', completed: false }], records).kind, 'video');
});

test('video must report a real ended state rather than just near-end position', () => {
  assert.equal(core.videoFinished({ ended: false, currentTime: 9.99, duration: 10 }), false);
  assert.equal(core.videoFinished({ ended: true, currentTime: 10, duration: 10 }), true);
  assert.equal(core.videoFinished({ ended: true, currentTime: 0, duration: 10 }), false);
  assert.equal(core.videoFinished({ ended: true, currentTime: 10, duration: NaN }), false);
  assert.equal(core.videoFinished({ ended: true, currentTime: 10, duration: Infinity }), false);
});

test('lease denies a second owner until expiry but lets the same tab renew', () => {
  assert.equal(core.leaseAvailable({ owner: 'a', expires: 2000 }, 'b', 1000), false);
  assert.equal(core.leaseAvailable({ owner: 'a', expires: 2000 }, 'a', 1000), true);
  assert.equal(core.leaseAvailable({ owner: 'a', expires: 2000 }, 'b', 2001), true);
  assert.equal(core.leaseAvailable(null, 'a', 0), true);
});

test('corrupt or foreign persisted data cannot trigger an automatic run', () => {
  assert.equal(core.restoreProgress({ running: true }).running, false);
  assert.equal(core.restoreProgress({ version: 1, courseId: 'other', classId: '299118', running: true }).running, false);
  const p = core.restoreProgress(null);
  assert.deepEqual(p.chapters, []);
  assert.deepEqual(p.records, {});
});

test('explicit catalog-scan handoff survives refresh but an empty unarmed run does not', () => {
  const seed = { ...core.restoreProgress(null), owner: 'tab-a', running: true };
  assert.equal(core.restoreProgress(seed).running, false);
  assert.equal(core.restoreProgress({ ...seed, phase: 'scan' }).running, true);
  assert.equal(core.restoreProgress({ ...seed, phase: 'scan' }).phase, 'scan');
});

test('a valid pending course navigation survives progress restoration', () => {
  const seed = { ...core.restoreProgress(null), owner: 'tab-a', running: true, chapters: [{ id: '123', title: '知识点' }],
    navigation: { owner: 'tab-a', url: `https://${core.HOST}/learnPage/${core.COURSE}/123/${core.CLASS}`, expires: 5000 } };
  assert.deepEqual(core.restoreProgress(seed).navigation, seed.navigation);
  assert.equal(core.restoreProgress({ ...seed, navigation: { ...seed.navigation, url: 'https://example.org/' } }).navigation, null);
  assert.equal(core.restoreProgress({ ...seed, navigation: { ...seed.navigation, owner: 'tab-b' } }).navigation, null);
});

test('persisted numeric IDs are rejected rather than silently rounding large identifiers', () => {
  const seed = { ...core.restoreProgress(null), chapters: [{ id: 1942858164356464640, title: 'invalid numeric ID' }] };
  assert.deepEqual(core.restoreProgress(seed).chapters, []);
});
