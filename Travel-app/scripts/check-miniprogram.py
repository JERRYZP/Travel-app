#!/usr/bin/env python3
"""
小程序静态一致性检查（2026-09-20）

捕捉那些「编译不报错、真机才发现」的问题——纯 JS 单测覆盖不到模板层：

  1. WXML 里 `<svg-icon name="x">` 的图标文件是否存在（写错名字不会报错，只是空白）
  2. JSON `usingComponents` 的路径是否解析得到
  3. `app.json` 的 pages 是否三件套齐全
  4. WXML 绑定的方法在对应 js 里是否存在（拼错就是点了没反应）
  5. WXSS 引用的 CSS 变量是否在 app.wxss 里定义（未定义 = 静默失效成默认色）
  6. 主包体积（代码质量线 1.5MB）与图片/音频资源总量（代码质量线 200KB）
  7. mock.js 只被 utils/api.js 引用（否则 121KB 镜像被打进主包）

用法：python3 scripts/check-miniprogram.py   （退出码非 0 表示有问题）

⚠️ 扫的是手写源码，跳过 miniprogram_npm（第三方构建产物）。
"""
import json
import os
import re
import sys

ROOT = "miniprogram"
SKIP_DIRS = {"miniprogram_npm", "node_modules"}
MAX_PACKAGE_BYTES = int(1.5 * 1024 * 1024)

problems = []


def walk(base):
    for dirpath, dirnames, filenames in os.walk(base):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for fn in filenames:
            yield os.path.join(dirpath, fn)


def walk_all(base):
    for dirpath, dirnames, filenames in os.walk(base):
        dirnames[:] = [d for d in dirnames if d != "node_modules"]
        for fn in filenames:
            yield os.path.join(dirpath, fn)


def check_icons(files):
    icons = {f[:-4] for f in os.listdir(os.path.join(ROOT, "images", "icons"))
             if f.endswith(".svg")}
    for f in files:
        if not f.endswith(".wxml"):
            continue
        src = open(f, encoding="utf-8").read()
        for m in re.finditer(r'<svg-icon[^>]*name="([^"{}]+)"', src):
            if m.group(1) not in icons:
                problems.append(f'{f}: svg-icon "{m.group(1)}" 在 images/icons 下不存在')


def check_components(files):
    for f in files:
        if not f.endswith(".json"):
            continue
        try:
            j = json.load(open(f, encoding="utf-8"))
        except json.JSONDecodeError as e:
            problems.append(f"{f}: JSON 解析失败 {e}")
            continue
        for name, path in (j.get("usingComponents") or {}).items():
            if path.startswith("@"):
                continue
            # 以 / 开头 = 相对 miniprogram 根；否则相对当前文件
            base = os.path.join(ROOT, path.lstrip("/")) if path.startswith("/") \
                else os.path.join(os.path.dirname(f), path)
            if not os.path.exists(base + ".wxml"):
                problems.append(f"{f}: 组件 {name} → {path} 找不到")


def check_wxs(files):
    for f in files:
        if not f.endswith(".wxml"):
            continue
        src = open(f, encoding="utf-8").read()
        for m in re.finditer(r'<wxs[^>]*src="([^"]+)"', src):
            path = m.group(1)
            base = os.path.join(ROOT, path.lstrip("/")) if path.startswith("/") \
                else os.path.join(os.path.dirname(f), path)
            if not os.path.exists(base):
                problems.append(f"{f}: WXS {path} 找不到")


def check_pages():
    app = json.load(open(os.path.join(ROOT, "app.json"), encoding="utf-8"))
    for p in app.get("pages", []):
        for ext in (".js", ".wxml", ".json"):
            if not os.path.exists(os.path.join(ROOT, p + ext)):
                problems.append(f"app.json 声明的页面缺文件: {p}{ext}")


def check_handlers(files):
    for wxml in files:
        if not wxml.endswith(".wxml"):
            continue
        js = wxml[:-5] + ".js"
        if not os.path.exists(js):
            continue
        src = open(js, encoding="utf-8").read()
        tmpl = open(wxml, encoding="utf-8").read()
        for m in re.finditer(r'(?:bind|catch):?[a-zA-Z]+="([a-zA-Z_]\w*)"', tmpl):
            h = m.group(1)
            if not re.search(r"(^|[\s{,])" + h + r"\s*\(", src):
                problems.append(f"{wxml}: 绑定的方法 {h} 在 {os.path.basename(js)} 中不存在")


def check_css_vars(files):
    app_wxss = open(os.path.join(ROOT, "app.wxss"), encoding="utf-8").read()
    tokens = set(re.findall(r"--([\w-]+)\s*:", app_wxss))
    for f in files:
        if not f.endswith(".wxss"):
            continue
        for m in re.finditer(r"var\(--([\w-]+)\)", open(f, encoding="utf-8").read()):
            if m.group(1) not in tokens:
                problems.append(f"{f}: 未定义的 CSS 变量 --{m.group(1)}")


def check_package_size():
    """Fail before WeChat DevTools' 1.5MB main-package quality limit.

    This intentionally counts every file under miniprogram/, including the
    miniprogram_npm build output, because both sources and built components
    contribute to the uploaded main package.
    """
    total = 0
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d != "node_modules"]
        for fn in filenames:
            total += os.path.getsize(os.path.join(dirpath, fn))
    if total > MAX_PACKAGE_BYTES:
        problems.append(
            f"miniprogram 主包体积 {total / 1024:.1f}KB 超过 1536KB；请压缩图片或拆分分包"
        )


# 微信「代码质量」会把整个代码包内的图片/音频字节数相加，阈值只有 200KB。
# 大图统一放云存储，仓库根目录的 cloud-assets/ 是上传源文件，不进入代码包。
MAX_ASSET_BYTES = 200 * 1024
ASSET_EXTS = (".jpg", ".jpeg", ".png", ".svg", ".webp", ".gif", ".flac",
              ".m4a", ".ogg", ".ape", ".amr", ".wma", ".wav", ".mp3",
              ".mp4", ".aac", ".aiff", ".caf", ".bmp")


def check_asset_size(files):
    total = 0
    for f in files:
        if not f.lower().endswith(ASSET_EXTS):
            continue
        total += os.path.getsize(f)
    if total > MAX_ASSET_BYTES:
        problems.append(
            f"miniprogram 图片/音频合计 {total / 1024:.1f}KB 超过 200KB；"
            f"请把大图迁到 cloud-assets/ 并执行 scripts/upload-cloud-assets.sh"
        )


def check_mock_not_in_client():
    """mock.js 只能被 utils/api.js 引用。

    mock 是 121KB 的景点/规则镜像，只服务于单测和 USE_MOCK 离线联调。
    一旦有页面绕过 api.js 直接 require 它，整份镜像就会被打进主包——
    V0.3 期间主包超限留不出余量，根因就是 add-trip / spots / profile-edit
    三处 `require('../../utils/mock.js')` 的兜底分支。
    """
    mock_basename = "mock.js"
    for f in walk(ROOT):
        if not f.endswith(".js") or f.endswith(mock_basename):
            continue
        src = open(f, encoding="utf-8").read()
        for m in re.finditer(r"require\(['\"]([^'\"]*mock\.js)['\"]\)", src):
            rel = m.group(1)
            target = os.path.normpath(os.path.join(os.path.dirname(f), rel))
            if target != os.path.normpath(os.path.join(ROOT, "utils", "mock.js")):
                continue
            if os.path.normpath(f) != os.path.normpath(os.path.join(ROOT, "utils", "api.js")):
                problems.append(
                    f"{f}: 直接引用了 mock.js。mock 只允许被 utils/api.js 引用，"
                    f"否则 121KB 的镜像会被打进主包（请改走 api.* 调用）"
                )


def main():
    files = list(walk(ROOT))
    asset_files = list(walk_all(ROOT))
    check_icons(files)
    check_components(files)
    check_wxs(files)
    check_pages()
    check_handlers(files)
    check_css_vars(files)
    check_package_size()
    check_asset_size(asset_files)
    check_mock_not_in_client()
    if problems:
        print(f"发现 {len(problems)} 个问题：")
        for p in problems:
            print("  ✗ " + p)
        return 1
    print("小程序静态检查通过 ✓")
    return 0


if __name__ == "__main__":
    sys.exit(main())
