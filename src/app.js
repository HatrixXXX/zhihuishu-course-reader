(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'), require('./dom.js'));
  else {
    const api = factory(root.ZHSReadAll.core, root.ZHSReadAll.dom);
    root.ZHSReadAll.app = api;
    api.bootstrap();
  }
})(globalThis, function (core, dom) {
  'use strict';
  const STORAGE_KEY = 'zhs-read-all:2101609010059079680:299118:v1';
  const LEASE_KEY = STORAGE_KEY + ':lease';
  const HOME = `https://${core.HOST}/singleCourse/knowledgeStudy/${core.COURSE}/${core.CLASS}`;

  function createApp(env) {
    const { window: win, document: doc } = env;
    const pageWindow = env.pageWindow || win;
    const now = env.now || Date.now;
    const time = { poll: 1000, settle: 1500, dwell: 3000, load: 30000, stall: 90000, lease: 15000, ...env.timings };
    const tabId = env.tabId;
    let state = core.restoreProgress(env.getValue(STORAGE_KEY, null));
    let panel, statusElement, progressElement, logElement, muteControl;
    let aborter = null, task = null, heartbeat = null, activeMedia = null;
    const logs = [];
    const sleep = env.sleep || ((ms, signal) => new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(aborted());
      const id = win.setTimeout(done, ms);
      function done() { signal?.removeEventListener('abort', cancel); resolve(); }
      function cancel() { win.clearTimeout(id); signal.removeEventListener('abort', cancel); reject(aborted()); }
      signal?.addEventListener('abort', cancel, { once: true });
    }));
    function aborted() { return Object.assign(new Error('已暂停'), { name: 'AbortError' }); }
    function save() { env.setValue(STORAGE_KEY, state); render(); }
    function log(message) {
      logs.push(`${new Date(now()).toLocaleTimeString()} ${message}`);
      if (logs.length > 80) logs.shift();
      if (statusElement) statusElement.textContent = message;
      if (logElement) { logElement.value = logs.join('\n'); logElement.scrollTop = logElement.scrollHeight; }
      render();
    }
    function render() {
      if (progressElement) progressElement.textContent = `知识点 ${Object.values(state.chapterDone).filter(Boolean).length}/${state.chapters.length || '?'} · 已处理资源 ${Object.keys(state.records).length}`;
    }
    function claim() {
      const lease = env.getValue(LEASE_KEY, null);
      if (!core.leaseAvailable(lease, tabId, now())) return false;
      env.setValue(LEASE_KEY, { owner: tabId, expires: now() + time.lease });
      return env.getValue(LEASE_KEY, null)?.owner === tabId;
    }
    function ownsLease() { return env.getValue(LEASE_KEY, null)?.owner === tabId; }
    function check() {
      if (aborter?.signal.aborted || !state.running) throw aborted();
      if (!core.parseScope(win.location.href)) throw new Error('已离开指定课程，运行已停止。');
      if (env.getValue(LEASE_KEY, null)?.owner !== tabId) throw new Error('另一个标签页已接管运行。');
      if (dom.hasBlockingDialog(doc)) throw new Error('遇到登录、验证或答题弹窗，请手动处理后继续。');
    }
    async function waitFor(predicate, message, timeout = time.load) {
      const deadline = now() + timeout;
      for (;;) {
        check();
        const value = predicate();
        if (value) return value;
        if (now() >= deadline) throw new Error(message);
        await sleep(time.poll, aborter.signal);
      }
    }
    async function dwell(guard = () => {}) {
      const deadline = now() + time.dwell;
      while (now() < deadline) { check(); guard(); await sleep(Math.min(time.poll, deadline - now()), aborter.signal); }
      check(); guard();
    }
    function shown(element) {
      for (let node = element; node; node = node.parentElement) {
        const style = win.getComputedStyle(node);
        if (node.hidden || node.getAttribute('aria-hidden') === 'true' || style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
      }
      return true;
    }
    function checkDocument(resource) {
      if (!dom.isResourceSelected(resource, doc)) throw new Error('文档资源被切换，当前文档未记入断点。');
      for (const element of doc.querySelectorAll('[role="alert"], .el-message--error, .document-error, .preview-error')) {
        if (element.closest('.chatCardPage, .ai-sidebar, .ai-chatbot')) continue;
        if (shown(element) && /加载失败|无法预览|预览失败|加载出错|无法加载|资源不存在|preview failed|failed to load/i.test(element.textContent)) {
          throw new Error('文档加载失败，请检查预览后继续。');
        }
      }
    }
    async function requestPlayback(media) {
      let failure = null;
      try {
        const pending = media.play();
        if (pending && typeof pending.catch === 'function') pending.catch(error => { failure = error; });
      } catch (error) { failure = error; }
      await waitFor(() => {
        if (failure) throw new Error('浏览器阻止自动播放，请手动点一次视频播放后继续。');
        if (media.error) throw new Error('视频加载出错，请重试当前资源。');
        return !media.paused || core.videoFinished(media);
      }, '播放器启动超时，请检查网络或手动点一次播放后继续。');
    }
    function note(resource, nodeId, status) {
      check();
      state.records[core.resourceKey(nodeId, resource)] = { title: resource.title, kind: resource.kind, status, at: new Date(now()).toISOString() };
      save();
      log(`${status === 'watched' ? '视频已播放结束' : status === 'platform-complete' ? '平台已显示视频完成' : '已打开'}：${resource.title}`);
    }
    function pause() {
      aborter?.abort();
      if (activeMedia) activeMedia.pause();
      if (state.owner === tabId) { state.running = false; if (ownsLease()) save(); else render(); }
      log('已暂停，可从断点继续。');
    }
    function navigate(url) {
      save();
      log('正在进入下一个页面，页面加载后继续。');
      (env.navigate || (value => win.location.assign(value)))(url);
      return 'navigate';
    }
    async function openLink(resource) {
      const original = pageWindow.open;
      const opened = [];
      let failure = null;
      function open(value) {
        try {
          const url = new URL(String(value), win.location.href);
          if (!/^https?:$/.test(url.protocol)) throw new Error('链接不是 HTTP/HTTPS 地址。');
          if (opened.some(item => item.url === url.href)) return opened.find(item => item.url === url.href).handle;
          const handle = env.openInTab(url.href, { active: false, insert: true, setParent: true });
          if (!handle || handle.closed === true) throw new Error('浏览器未能打开链接标签页。');
          opened.push({ handle, url: url.href });
          return handle;
        } catch (error) { failure = error; return null; }
      }
      const hook = function (url) { return open(url); };
      const anchor = resource.element.querySelector('a[href]');
      const followAnchor = event => { event.preventDefault(); open(anchor.href); };
      try {
        pageWindow.open = hook;
        anchor?.addEventListener('click', followAnchor);
        (anchor || resource.clickTarget).click();
        await waitFor(() => { if (failure) throw failure; return opened.length > 0; }, '外链未打开，请检查脚本管理器的标签页权限后继续。');
        await dwell();
      } finally {
        anchor?.removeEventListener('click', followAnchor);
        if (pageWindow.open === hook) pageWindow.open = original;
        for (const item of opened) { try { item.handle.close(); } catch (_) { /* The user may already have closed it. */ } }
      }
    }
    async function watchVideo(resource, before, wasSelected) {
      const previousSource = before.source;
      const media = await waitFor(() => {
        if (!dom.isResourceSelected(resource, doc)) return null;
        const candidate = dom.findMedia(doc);
        if (!candidate) return null;
        const source = candidate.currentSrc || candidate.getAttribute('src') || '';
        if (!source || candidate.readyState < 1) return null;
        if (!wasSelected && before.media === candidate && source === previousSource) return null;
        return candidate;
      }, '视频播放器未加载或未切换，已停止以免误记完成。');
      activeMedia = media;
      media.muted = muteControl ? muteControl.checked : true;
      media.playbackRate = 1;
      await requestPlayback(media);
      let lastPosition = media.currentTime;
      let movedAt = now();
      while (true) {
        check();
        if (!dom.isResourceSelected(resource, doc) || dom.findMedia(doc) !== media) throw new Error('学习资源被切换，已暂停当前视频。');
        if (media.error) throw new Error('视频加载出错，请重试当前资源。');
        if (core.videoFinished(media)) break;
        if (media.currentTime > lastPosition) { lastPosition = media.currentTime; movedAt = now(); }
        if (now() - movedAt > time.stall) throw new Error('视频长时间没有播放进展，请检查网络或弹窗后继续。');
        if (media.paused && !media.ended) {
          await requestPlayback(media);
        }
        if (statusElement) statusElement.textContent = `正在播放：${resource.title}（${Math.floor(media.currentTime)} / ${Math.floor(media.duration || 0)} 秒）`;
        await sleep(time.poll, aborter.signal);
      }
      activeMedia = null;
    }
    async function visit(resource, nodeId) {
      check();
      if (resource.kind === 'unknown' || !resource.title) throw new Error(`无法识别资源类型：${resource.title || '无标题资源'}，请手动检查。`);
      log(`处理${resource.kind === 'video' ? '视频' : resource.kind === 'link' ? '链接' : '文档/图文'}：${resource.title}`);
      if (resource.kind === 'link') {
        await openLink(resource);
      } else {
        const previousMedia = dom.findMedia(doc);
        const before = { media: previousMedia, source: previousMedia ? (previousMedia.currentSrc || previousMedia.getAttribute('src') || '') : '' };
        const wasSelected = resource.active;
        resource.clickTarget.click();
        await sleep(time.settle, aborter.signal);
        await waitFor(() => dom.isResourceSelected(resource, doc), '资源未成功切换，请检查当前页面。');
        if (resource.kind === 'video') await watchVideo(resource, before, wasSelected);
        else {
          await waitFor(() => {
            checkDocument(resource);
            return ![...doc.querySelectorAll('.el-loading-mask')].some(shown);
          }, '文档仍在加载，请检查网络后继续。');
          await dwell(() => checkDocument(resource));
        }
      }
      if (core.parseScope(win.location.href)?.nodeId !== nodeId) throw new Error('知识点被切换，当前资源未记入断点。');
      note(resource, nodeId, resource.kind === 'video' ? 'watched' : 'opened');
    }
    async function runCatalog() {
      const items = await waitFor(() => { const list = dom.readCatalog(doc); return list.length ? list : null; }, '课程目录未加载，请刷新后重试。');
      // No percentage filter: electives can remain incomplete when the catalog says 100%.
      state.chapters = items.map(({ id, title }) => ({ id, title }));
      state.chapterDone = {};
      state.currentNodeId = items[0].id;
      state.phase = 'learn';
      save();
      log(`扫描到 ${items.length} 个知识点，开始遍历全部资源。`);
      (items[0].element.querySelector('.item-mask') || items[0].element).click();
      await waitFor(() => core.parseScope(win.location.href)?.nodeId === items[0].id, '进入知识点失败，请手动进入任一知识点后继续。');
    }
    async function run() {
      if (core.parseScope(win.location.href).page === 'catalog') await runCatalog();
      if (!state.chapters.length) {
        state.phase = 'scan';
        return navigate(HOME);
      }
      const nodeId = core.parseScope(win.location.href)?.nodeId;
      if (!nodeId || !state.chapters.some(c => c.id === nodeId)) throw new Error('当前知识点不在目录中，请回到课程目录重新开始。');
      state.currentNodeId = nodeId;
      save();
      await waitFor(() => dom.readResources(doc).length > 0, '当前知识点没有可识别的资源卡片，已暂停。');
      // Re-read after every card: the platform updates badges and may re-render the list.
      while (true) {
        check();
        if (core.parseScope(win.location.href)?.nodeId !== nodeId) throw new Error('知识点已切换，请从断点继续。');
        const resources = dom.readResources(doc);
        if (!resources.length) throw new Error('资源列表消失，已暂停。');
        for (const r of resources) {
          if (r.kind === 'video' && r.completed && !state.records[core.resourceKey(nodeId, r)]) note(r, nodeId, 'platform-complete');
        }
        const next = core.nextResource(nodeId, resources, state.records);
        if (!next) break;
        await visit(next, nodeId);
      }
      check();
      state.chapterDone[nodeId] = true;
      save();
      const nextChapter = state.chapters.find(c => state.chapterDone[c.id] !== true);
      if (nextChapter) {
        state.currentNodeId = nextChapter.id;
        state.phase = 'learn';
        const url = new URL(win.location.href);
        url.pathname = `/learnPage/${core.COURSE}/${nextChapter.id}/${core.CLASS}`;
        return navigate(url.href);
      }
      state.running = false;
      save();
      log('全部已遍历：文档和链接已打开，视频已播放结束或平台已显示完成。平台计分以课程页面为准。');
      return 'finished';
    }
    function start() {
      if (!core.parseScope(win.location.href)) return Promise.resolve();
      if (task) return task;
      if (!claim()) { log('另一个课程标签页正在运行，请先在那个页面暂停。'); return Promise.resolve(); }
      // Reload shared progress if another tab finished work since this panel was opened.
      state = core.restoreProgress(env.getValue(STORAGE_KEY, null));
      aborter = new win.AbortController();
      state.running = true;
      state.owner = tabId;
      save();
      heartbeat = win.setInterval(() => { if (!claim()) pause(); }, Math.max(1000, time.lease / 3));
      task = (async () => {
        let outcome;
        try { check(); outcome = await run(); }
        catch (error) {
          if (error.name !== 'AbortError') {
            state.running = false;
            if (activeMedia) activeMedia.pause();
            if (ownsLease()) save(); else render();
            log(`已暂停：${error.message}`);
          }
        } finally {
          win.clearInterval(heartbeat); heartbeat = null;
          if (outcome !== 'navigate') {
            state.running = false;
            if (ownsLease()) { save(); env.deleteValue(LEASE_KEY); }
            else render();
          }
          activeMedia = null;
        }
      })().finally(() => { task = null; });
      return task;
    }
    function resume() {
      if (!state.running || state.owner !== tabId) return Promise.resolve();
      const scope = core.parseScope(win.location.href);
      if (scope?.page === 'learn' && state.currentNodeId && scope.nodeId !== state.currentNodeId) {
        state.running = false; save(); log('检测到手动切换知识点，已暂停，请点击开始/继续。'); return Promise.resolve();
      }
      return start();
    }
    function mount() {
      if (!core.parseScope(win.location.href) || doc.getElementById('zhs-read-all-panel')) return;
      panel = doc.createElement('section');
      panel.id = 'zhs-read-all-panel';
      panel.setAttribute('aria-label', '全资源学习助手');
      panel.innerHTML = '<strong>国家安全概论 · 全资源学习助手</strong><p data-status>待开始：包含必学和选学</p><p data-progress></p><div class="zra-actions"><button data-start>开始/继续</button><button data-pause>暂停</button><button data-reset>清除本地断点</button></div><label><input type="checkbox" data-mute checked>静音播放视频（1 倍速）</label><textarea readonly aria-label="运行日志" rows="5"></textarea><small>文档/外链打开并停留 3 秒。遇到验证、答题或加载异常会暂停。</small>';
      const style = doc.createElement('style');
      style.textContent = '#zhs-read-all-panel{position:fixed;right:20px;bottom:20px;z-index:2147483646;width:350px;max-width:90vw;background:#fff;color:#17212d;border:1px solid #c7d5e4;border-radius:10px;padding:14px;box-shadow:0 4px 24px #0003;font:13px/1.5 system-ui,sans-serif;text-align:left}#zhs-read-all-panel p{margin:8px 0;overflow-wrap:anywhere}#zhs-read-all-panel button{padding:5px 8px;border:1px solid #a9c5e3;border-radius:5px;background:#eff6ff;color:#123;margin:0 6px 8px 0;cursor:pointer}#zhs-read-all-panel label{display:block;margin:4px 0}#zhs-read-all-panel textarea{box-sizing:border-box;display:block;width:100%;margin:8px 0;color:#334;background:#f6f8fb;font:11px/1.5 monospace;border:1px solid #dce4ee;resize:vertical}#zhs-read-all-panel small{display:block;color:#526273}';
      panel.appendChild(style);
      doc.body.appendChild(panel);
      statusElement = panel.querySelector('[data-status]');
      progressElement = panel.querySelector('[data-progress]');
      logElement = panel.querySelector('textarea');
      muteControl = panel.querySelector('[data-mute]');
      panel.querySelector('[data-start]').addEventListener('click', () => { start().catch(error => log(error.message)); });
      panel.querySelector('[data-pause]').addEventListener('click', pause);
      panel.querySelector('[data-reset]').addEventListener('click', () => {
        const lease = env.getValue(LEASE_KEY, null);
        if (!core.leaseAvailable(lease, tabId, now())) { log('请先在另一个标签页暂停运行。'); return; }
        if (!win.confirm('清除这个工具的本地断点？平台的学习记录不会改变。')) return;
        pause(); state = core.restoreProgress(null); save(); log('本地断点已清除，请从课程目录开始。');
      });
      render();
    }
    return { mount, start, resume, pause, getState: () => state };
  }

  async function bootstrap() {
    if (typeof window === 'undefined' || window.top !== window.self || !core.parseScope(window.location.href)) return;
    if (globalThis.ZHSReadAll.instance) return;
    if (!document.body) await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
    const tab = await new Promise(resolve => GM_getTab(resolve));
    if (!tab.zhsReadAllId) { tab.zhsReadAllId = crypto.randomUUID(); GM_saveTab(tab); }
    const app = createApp({ window, document, tabId: tab.zhsReadAllId, pageWindow: unsafeWindow, getValue: GM_getValue, setValue: GM_setValue, deleteValue: GM_deleteValue, openInTab: GM_openInTab });
    globalThis.ZHSReadAll.instance = app;
    app.mount();
    app.resume().catch(console.error);
  }
  return { createApp, bootstrap, STORAGE_KEY, LEASE_KEY };
});
