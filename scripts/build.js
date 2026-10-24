const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist', '国家安全概论-全部资源.user.js');
const header = `// ==UserScript==
// @name         国家安全概论 · 全部资源学习助手
// @namespace    local.zhihuishu.course-reader
// @version      1.0.0
// @description  遍历本课程全部必学和选学资源，打开文档和链接，顺序播放视频，支持暂停和断点继续。
// @match        https://ai-smart-course-student-pro.zhihuishu.com/singleCourse/knowledgeStudy/2101609010059079680/299118*
// @match        https://ai-smart-course-student-pro.zhihuishu.com/learnPage/2101609010059079680/*/299118*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_getTab
// @grant        GM_saveTab
// @grant        GM_openInTab
// @grant        unsafeWindow
// @run-at       document-idle
// @noframes
// ==/UserScript==
`;
function build() {
  const modules = ['core.js', 'dom.js', 'app.js'].map(file => fs.readFileSync(path.join(root, 'src', file), 'utf8'));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, header + '\n' + modules.join('\n\n'), 'utf8');
  return output;
}
if (require.main === module) console.log(build());
module.exports = { build };
