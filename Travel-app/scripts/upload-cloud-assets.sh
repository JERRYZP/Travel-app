#!/usr/bin/env bash
set -euo pipefail

# 大图源文件保留在 cloud-assets/，不进入 200KB 的图片/音频代码包额度。
# 首次配置或更换云环境后，需由本机已登录的微信开发者工具执行上传。
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CLIENT="${WECHATIDE_CLIENT:-default}"
APPID="${WECHATIDE_APPID:-wx05c160a589b97d76}"
ENV_ID="${WECHATIDE_ENV:-cloud1-d9g9f4hja396d6e92}"

wechatide -c "$CLIENT" cloud_manage_storage \
  --appid "$APPID" \
  --env "$ENV_ID" \
  --action upload \
  --cloud-path static/v0.3/images/ \
  --local-path "$ROOT_DIR/cloud-assets/images" \
  --is-directory
