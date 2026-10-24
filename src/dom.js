(function (root) {
  'use strict';

  const HOST = 'https://ai-smart-course-student-pro.zhihuishu.com';
  const COURSE_ID = '2101609010059079680';
  const CLASS_ID = '299118';
  const CONFIRMED_CNKI_TITLES = new Set([
    '颠覆性技术与科技安全',
    '军民融合型科技工业协同创新体系构建研究——基于国际比较视角',
  ]);

  function text(value) {
    return (value || '').replace(/\s+/g, ' ').trim();
  }

  function isVisible(element) {
    for (let current = element; current; current = current.parentElement) {
      if (current.hidden || current.getAttribute('aria-hidden') === 'true') return false;
      const style = current.ownerDocument.defaultView.getComputedStyle(current);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.opacity === '0') return false;
    }
    return true;
  }

  function readPage(url) {
    let parsed;
    try { parsed = new URL(url); } catch (_) { return null; }
    if (parsed.origin !== HOST) return null;

    const catalog = parsed.pathname.match(/^\/singleCourse\/knowledgeStudy\/(\d+)\/(\d+)\/?$/);
    const learn = parsed.pathname.match(/^\/learnPage\/(\d+)\/(\d+)\/(\d+)\/?$/);
    if (!catalog && !learn) return null;
    const courseId = catalog ? catalog[1] : learn[1];
    const classId = catalog ? catalog[2] : learn[3];
    if (courseId !== COURSE_ID || classId !== CLASS_ID) return null;
    return { page: catalog ? 'catalog' : 'learn', courseId, classId, nodeId: learn ? learn[2] : null };
  }

  function readCatalog(document) {
    const seen = new Set();
    const result = [];
    for (const element of document.querySelectorAll('[knowledgeid], [id^="knowledgeId-"]')) {
      const id = element.getAttribute('knowledgeid') || element.id.replace(/^knowledgeId-/, '');
      if (!/^\d+$/.test(id) || seen.has(id)) continue;
      const titleElement = element.querySelector('.item-title');
      const title = text(titleElement && (titleElement.getAttribute('title') || titleElement.textContent));
      seen.add(id);
      result.push({ id, title, element });
    }
    return result;
  }

  function cnkiDestination(value, base) {
    try {
      const url = new URL(String(value), base);
      if (/^https?:$/.test(url.protocol) && /(^|\.)cnki\.(?:net|com\.cn)$/i.test(url.hostname)) return url.href;
    } catch (_) { /* Ignore malformed links. */ }
    return null;
  }

  function cnkiUrl(element) {
    for (const anchor of element.querySelectorAll('a[href]')) {
      const url = cnkiDestination(anchor.getAttribute('href'), element.ownerDocument.baseURI);
      if (url) return url;
    }
    return null;
  }

  function resourceKind(element, title, manualUrl) {
    if (manualUrl) return 'manual';
    if (element.querySelector('.icon-box.video') || /\.(?:mp4|webm|m4v|mov|m3u8)$/i.test(title)) return 'video';
    if (CONFIRMED_CNKI_TITLES.has(title)) return 'manual';
    if (element.querySelector('.icon-box.zhihu, .icon-box.link')) return 'link';
    if (/\.(?:pdf|pptx?|docx?|xlsx?|odt|odp|epub)$/i.test(title)) return 'document';
    if (element.querySelector('.icon-box.other') && /^\d+\s*页$/.test(text(element.querySelector('.page-num')?.textContent))) return 'document';
    if (element.querySelector('.icon-box.text') || /\.(?:txt|md)$/i.test(title)) return 'text';
    for (const anchor of element.querySelectorAll('a[href]')) {
      const href = anchor.getAttribute('href').trim();
      if (!href || href.startsWith('#')) continue;
      try {
        if (/^https?:$/.test(new URL(href, element.ownerDocument.baseURI).protocol)) return 'link';
      } catch (_) { /* A malformed href is not evidence of a supported resource. */ }
    }
    return 'unknown';
  }

  function readResources(document) {
    const occurrences = new Map();
    return Array.from(document.querySelectorAll('.basic-info-video-card-container'), (element, index) => {
      const clickTarget = element.querySelector('.video-title.common-text, .video-title, h5') || element;
      const titleElement = clickTarget.querySelector('h5') || clickTarget;
      const title = text(titleElement.getAttribute('title') || (titleElement === element ? '' : titleElement.textContent));
      const url = cnkiUrl(element);
      const kind = resourceKind(element, title, url);
      const identity = `${kind}:${encodeURIComponent(title)}`;
      const occurrence = (occurrences.get(identity) || 0) + 1;
      occurrences.set(identity, occurrence);
      const completed = Array.from(element.querySelectorAll('.finished-icon')).some(badge =>
        isVisible(badge) && /^(?:已完成|100(?:\.0+)?%)$/.test(text(badge.textContent).replace(/\s/g, '')));
      return {
        id: `${identity}:${occurrence}`, title, kind, url, completed,
        active: element.classList.contains('active'), index, element, clickTarget,
      };
    });
  }

  function isResourceSelected(resource, document) {
    return Boolean(resource && readResources(document).some(current => current.id === resource.id && current.active));
  }

  function findMedia(document) {
    const visited = new Set();

    function search(currentDocument) {
      if (visited.has(currentDocument)) return null;
      visited.add(currentDocument);
      const wrappers = Array.from(currentDocument.querySelectorAll('.video-player-wrapper')).filter(isVisible);
      const scopes = wrappers.length ? wrappers : [currentDocument];
      for (const scope of scopes) {
        for (const media of scope.querySelectorAll('video, audio')) {
          if (isVisible(media)) return media;
        }
        for (const frame of scope.querySelectorAll('iframe')) {
          if (!isVisible(frame)) continue;
          try {
            const frameDocument = frame.contentDocument;
            const media = frameDocument && search(frameDocument);
            if (media) return media;
          } catch (_) { /* Cross-origin players require manual handling. */ }
        }
      }
      return null;
    }

    return search(document);
  }

  function hasBlockingDialog(document) {
    const gates = '.question-dialog, .quiz-dialog, .captcha, .captcha-modal, .captcha-dialog, .login-modal, .login-dialog';
    const dialogs = document.querySelectorAll(`${gates}, [role="dialog"], .el-dialog, .el-message-box, .ant-modal`);
    for (const dialog of dialogs) {
      if (!isVisible(dialog) || dialog.closest('.ai-chatbot, .ai-sidebar, .chatbot, .ai-assistant, [data-chatbot]')) continue;
      if (dialog.matches(gates)) return true;
      if (/随堂(?:测试|测验|问题)|章节(?:测试|测验)|请.*(?:登录|登陆|作答|答题|验证)|登录(?:已过期|失效)|验证码|滑块验证|安全验证|人机验证|视频(?:问题|测验)|请回答以下问题|答题后继续/.test(text(dialog.textContent))) return true;
    }
    return false;
  }

  const dom = { readCatalog, readResources, readPage, findMedia, isResourceSelected, hasBlockingDialog, cnkiDestination };

  if (typeof module !== 'undefined' && module.exports) module.exports = dom;
  else {
    root.ZHSReadAll = root.ZHSReadAll || {};
    root.ZHSReadAll.dom = dom;
  }
})(globalThis);
