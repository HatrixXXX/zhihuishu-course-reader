from html import escape
from pathlib import Path
import hashlib
import json
import subprocess
import zipfile


project = Path(__file__).resolve().parent.parent
version = json.loads((project / 'package.json').read_text(encoding='utf-8'))['version']
subprocess.run(['node', 'scripts/build.js'], cwd=project, check=True)
script_name = '国家安全概论-全部资源.user.js'
script = (project / 'dist' / script_name).read_bytes()
course = 'https://ai-smart-course-student-pro.zhihuishu.com/singleCourse/knowledgeStudy/2101609010059079680/299118'

guide = f'''智慧树课程助手 v{version}：另一台电脑安装说明

一、准备
1. 解压整个压缩包。
2. 在新电脑的浏览器中安装篡改猴或脚本猫，任选一个即可。篡改猴官网：https://www.tampermonkey.net/
3. 用你自己的账号登录智慧树，确认能打开下面的课程链接。

二、安装
1. 双击“安装助手.html”，点击“复制脚本”。页面可以离线打开。
2. 在脚本管理器中选择“新建脚本”，Ctrl+A 全选默认内容，Ctrl+V 粘贴，然后保存（通常是 Ctrl+S）。
3. 打开课程目录并刷新，右下角出现“全资源学习助手”后，点击“开始/继续”。

如果复制按钮没有成功，展开安装页中的脚本全文，点“选中代码”，再按 Ctrl+C。
也可以用文本编辑器打开“{script_name}”，复制全部内容后粘贴到新建脚本中。
无需安装 Node.js、Python 或启动本地服务。保存后，按脚本管理器的提示启用脚本或用户脚本权限。

课程目录：
{course}

三、运行
工具会检查每个知识点中的必学和选学资源。
PPT、文档和图文会逐项打开并停留 3 秒；外链会打开到后台标签页，停留后关闭。
未完成的平台视频默认静音、1 倍速播放到结束；平台已明确显示完成的视频会跳过。
已确认的知网安全验证链接会留待人工处理，脚本继续扫描后面的资源，不会将其记为已打开。
全部遍历后，右下角显示统计报告、待人工处理清单和对应的课程位置链接；卡片带有知网直链时也会列出。
请按清单返回课程页面，手动完成这些资源。其他登录、验证、答题或加载异常仍会暂停，处理后可继续运行。

四、换电脑后的记录
平台学习进度保存在智慧树账号中。这个工具的断点保存在各台电脑自己的脚本管理器里，本安装包不会迁移旧电脑的断点。
新电脑会重新扫描课程；平台已完成的视频仍会跳过，文档和外链可能重新打开。
本版本只适用于上面的课程和班级链接。

五、验证范围
本版本已通过本地自动化测试，尚未在真实平台完整跑过全课。平台进度和计分以课程页面为准。
'''

source_html = escape(script.decode('utf-8'), quote=False)
installer = f'''<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>课程助手离线安装</title>
<style>
body{{margin:0;background:#f3f6fa;color:#17212d;font:16px/1.7 system-ui,sans-serif}}
main{{max-width:780px;margin:40px auto;padding:28px;background:white;border:1px solid #dce4ee;border-radius:12px}}
h1{{margin-top:0;font-size:25px}}button,a.action{{display:inline-block;padding:10px 16px;margin:4px 10px 4px 0;border:0;border-radius:6px;background:#1667d2;color:white;font-size:15px;cursor:pointer;text-decoration:none}}
textarea{{box-sizing:border-box;width:100%;height:260px;border:1px solid #cbd5e1;padding:10px;font:12px/1.5 monospace}}
#status{{min-height:28px;color:#245d39}}small{{color:#526273}}li{{margin:10px 0}}
@media(max-width:820px){{main{{margin:14px;padding:20px}}}}
</style><main>
<h1>国家安全概论课程助手 v{version}</h1>
<p>这个安装页可离线打开。浏览器中需要先安装篡改猴或脚本猫。</p>
<ol><li>点击“复制脚本”。</li><li>在脚本管理器中新建脚本，全选默认内容，粘贴并保存。</li><li>打开课程目录并刷新，点击右下角的“开始/继续”。</li></ol>
<button id="copy">复制脚本</button><a class="action" href="{course}" target="_blank" rel="noopener">打开课程目录</a>
<p id="status" role="status">等待复制。</p>
<details><summary>查看脚本全文 / 手动复制</summary><button id="select">选中代码</button><textarea id="source" readonly aria-label="课程助手脚本全文">{source_html}</textarea></details>
<p><small>包括必学和选学。文档、外链逐项打开，视频正常播放；知网待验证链接在遍历报告中留待人工处理。其他暂停或异常的处理方式见“安装说明.txt”。</small></p>
</main><script>
const source = document.getElementById('source');
const status = document.getElementById('status');
function selectCode() {{ document.querySelector('details').open = true; source.focus(); source.select(); status.textContent = '代码已选中，请按 Ctrl+C 复制，再到脚本管理器粘贴并保存。'; }}
document.getElementById('select').addEventListener('click', selectCode);
document.getElementById('copy').addEventListener('click', async () => {{
  try {{
    if (!navigator.clipboard?.writeText) throw new Error('Manual copy required');
    await navigator.clipboard.writeText(source.value);
    status.textContent = '已复制。请在脚本管理器中新建脚本，粘贴后保存。';
  }} catch (_) {{ selectCode(); }}
}});
</script></html>'''

release_dir = project / 'releases'
release_dir.mkdir(exist_ok=True)
archive_path = release_dir / f'zhihuishu-course-reader-v{version}.zip'
prefix = f'智慧树课程助手-v{version}/'
files = {
    script_name: script,
    '安装助手.html': installer.encode('utf-8'),
    '安装说明.txt': guide.encode('utf-8-sig'),
}
with zipfile.ZipFile(archive_path, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
    for name, data in files.items():
        archive.writestr(prefix + name, data)

# Check the actual archive, including CRCs, embedded script and relative/offline use.
with zipfile.ZipFile(archive_path) as archive:
    assert archive.testzip() is None
    assert set(archive.namelist()) == {prefix + name for name in files}
    assert archive.read(prefix + script_name) == script
    html = archive.read(prefix + '安装助手.html').decode('utf-8')
    from html.parser import HTMLParser

    class SourceParser(HTMLParser):
        def __init__(self):
            super().__init__(convert_charrefs=True)
            self.in_source = False
            self.parts = []

        def handle_starttag(self, tag, attrs):
            if tag == 'textarea' and dict(attrs).get('id') == 'source':
                self.in_source = True

        def handle_endtag(self, tag):
            if tag == 'textarea':
                self.in_source = False

        def handle_data(self, data):
            if self.in_source:
                self.parts.append(data)

    parser = SourceParser()
    parser.feed(html)
    assert ''.join(parser.parts).encode('utf-8') == script
    assert '127.0.0.1' not in html and 'localhost' not in html
    assert '<script src=' not in html and 'http://127.' not in html

print(json.dumps({
    'archive': str(archive_path),
    'size': archive_path.stat().st_size,
    'files': list(files),
    'script_sha256': hashlib.sha256(script).hexdigest(),
    'archive_verified': True,
    'embedded_copy_verified': True,
}, ensure_ascii=False), flush=True)
