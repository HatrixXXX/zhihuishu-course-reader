(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.ZHSReadAll ||= {}).core = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const COURSE = '2101609010059079680';
  const CLASS = '299118';
  const HOST = 'ai-smart-course-student-pro.zhihuishu.com';

  function parseScope(value) {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.hostname !== HOST || url.port) return null;
      let m = url.pathname.match(/^\/singleCourse\/knowledgeStudy\/(\d+)\/(\d+)\/?$/);
      if (m && m[1] === COURSE && m[2] === CLASS) return { page: 'catalog', courseId: m[1], classId: m[2], nodeId: null };
      m = url.pathname.match(/^\/learnPage\/(\d+)\/(\d+)\/(\d+)\/?$/);
      if (m && m[1] === COURSE && m[3] === CLASS) return { page: 'learn', courseId: m[1], classId: m[3], nodeId: m[2] };
    } catch (_) { /* Invalid or out-of-scope URLs are inert. */ }
    return null;
  }

  function resourceKey(nodeId, resource) { return JSON.stringify([String(nodeId), resource.id]); }
  function cnkiUrl(value) {
    try {
      const parsed = new URL(value);
      if (/^https?:$/.test(parsed.protocol) && /(^|\.)cnki\.(?:net|com\.cn)$/i.test(parsed.hostname)) return parsed.href;
    } catch (_) { /* Only an explicit CNKI address can identify a manual link. */ }
    return null;
  }
  function isDone(resource, record) {
    if (record?.status === 'skipped') return true;
    if (resource.kind === 'manual') return record?.status === 'skipped';
    if (resource.kind === 'video') return resource.completed === true || ['watched', 'platform-complete'].includes(record?.status);
    if (resource.kind === 'unknown') return record?.status === 'opened' && record.kind === 'link' && /^https?:\/\//.test(record.url || '');
    return resource.kind !== 'unknown' && record?.status === 'opened';
  }
  function nextResource(nodeId, resources, records) {
    const handled = Object.values(records).filter(r => r.nodeId === String(nodeId) && Number.isInteger(r.index) &&
      ((r.status === 'skipped' && (r.kind === 'manual' || cnkiUrl(r.url))) ||
        (r.status === 'opened' && r.kind === 'link' && /^https?:\/\//.test(r.url || ''))));
    return resources.find(r => !isDone(r, records[resourceKey(nodeId, r)]) &&
      (r.kind === 'video' || !handled.some(record => record.index === r.index && record.title === r.title))) || null;
  }
  function videoFinished(media) {
    return media?.ended === true && Number.isFinite(media.duration) && media.duration > 0 &&
      Number.isFinite(media.currentTime) && media.currentTime >= media.duration - 0.5;
  }
  function leaseAvailable(lease, owner, now) {
    return !lease || lease.owner === owner || !Number.isFinite(lease.expires) || lease.expires <= now;
  }
  function restoreProgress(raw) {
    const empty = { version: 1, courseId: COURSE, classId: CLASS, running: false, owner: null, chapters: [], chapterDone: {}, records: {}, currentNodeId: null };
    if (!raw || raw.version !== 1 || raw.courseId !== COURSE || raw.classId !== CLASS || !Array.isArray(raw.chapters) || !raw.records || typeof raw.records !== 'object') return empty;
    const chapters = raw.chapters.filter(c => c && typeof c.id === 'string' && /^\d+$/.test(c.id) && typeof c.title === 'string').map(c => ({ id: c.id, title: c.title }));
    const records = Object.fromEntries(Object.entries(raw.records).filter(([, r]) => r && ['opened', 'watched', 'platform-complete', 'skipped'].includes(r.status)));
    const phase = ['scan', 'learn', 'finished'].includes(raw.phase) ? raw.phase : null;
    return { ...empty, chapters, records, phase, chapterDone: raw.chapterDone && typeof raw.chapterDone === 'object' ? { ...raw.chapterDone } : {}, currentNodeId: typeof raw.currentNodeId === 'string' ? raw.currentNodeId : null, running: raw.running === true && (chapters.length > 0 || phase === 'scan') && typeof raw.owner === 'string', owner: typeof raw.owner === 'string' ? raw.owner : null };
  }
  function progressReport(state) {
    const records = Object.values(state.records);
    return {
      opened: records.filter(r => r.status === 'opened').length,
      watched: records.filter(r => r.status === 'watched').length,
      platformComplete: records.filter(r => r.status === 'platform-complete').length,
      skipped: records.filter(r => r.status === 'skipped').map(r => {
        const chapter = state.chapters.find(c => c.id === r.nodeId);
        let courseUrl = null;
        if (typeof r.nodeId === 'string' && /^\d+$/.test(r.nodeId)) {
          const target = new URL(`https://${HOST}/learnPage/${COURSE}/${r.nodeId}/${CLASS}`);
          if (typeof r.mapUid === 'string' && /^\d+$/.test(r.mapUid)) target.searchParams.set('mapUid', r.mapUid);
          courseUrl = target.href;
        }
        const url = cnkiUrl(r.url);
        return {
          title: r.title, chapterTitle: chapter?.title || '未知知识点',
          courseUrl,
          url, reason: typeof r.reason === 'string' ? r.reason : null,
        };
      }),
    };
  }
  return { COURSE, CLASS, HOST, parseScope, resourceKey, isDone, nextResource, videoFinished, leaseAvailable, restoreProgress, progressReport };
});
