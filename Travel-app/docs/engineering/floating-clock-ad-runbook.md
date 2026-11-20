# 悬浮时钟激励视频震动解锁 Runbook

## 方案边界

- 广告位：`adunit-ae770b8ec9fcd605`
- 权益对象：有效 `membership.unlimited=true` 会员
- 解锁范围：从领取成功起，到当前 `memberExpiresAt`
- 微信小程序官方没有激励视频服务器回调，不创建广告 HTTP 回调。
- 客户端只消费官方 `RewardedVideoAd.onClose({ isEnded })`；完整观看后提交服务端一次性凭证。

## 当前执行状态

- 2026-11-20：功能已进入最新体验版 `2.6.1`；不单独宣称已正式发布。
- `rewarded_ad_attempts` 已在 `cloud1-d9g9f4hja396d6e92` 创建并回读；`reminder` 相关接口已部署。
- `2.5.0-rc.2` 的历史上传记录仍见 Git；当前现役体验基线以 `2.6.1` 为准。
- 未提交审核、未发布正式版；真实广告完整观看、中途关闭、跨设备和权益失效场景仍待真机验收。

## 服务端真身

用户字段：

```text
users.vibrationUnlockedUntil
users.vibrationUnlockSource = REWARDED_AD
users.vibrationUnlockAttemptId
users.vibrationUnlockedAt
```

广告凭证集合：

```text
rewarded_ad_attempts
```

集合权限：仅管理端可读写。按确定性文档 ID 读写，不需要额外索引。

## 上线顺序

1. 在云开发控制台创建 `rewarded_ad_attempts`。
2. 确认集合权限为「仅管理端可读写」。
3. 经用户明确授权后部署 `reminder`；不得跳过第 1 步。
4. 上传包含广告客户端的新体验版。
5. 用真实不限额度会员账号在真机验收。

不需要部署 `payment`，不需要配置广告服务器回调地址或密钥。

## 真机验收

### 中途关闭

1. 不限额度会员进入会员页。
2. 点击「看广告视频解锁震动功能」。
3. 广告播放中关闭。
4. 必须提示「完整观看广告后才能解锁」，权益保持锁定。

### 完整观看

1. 重新进入广告并完整观看。
2. `onClose` 返回 `isEnded=true`。
3. 客户端提交一次性凭证。
4. 页面显示已解锁，震动开关自动打开。
5. 服务端用户字段 `vibrationUnlockedUntil` 等于本次 `memberExpiresAt`。

### 跨设备与缓存

1. 清理小程序缓存或换设备。
2. 服务端仍返回 `vibrationUnlocked=true`。
3. 页面不得要求再次看广告。
4. 本机震动开关仍允许用户自行关闭。

### 失效

- 会员到期后，`membership.status.membership.vibrationUnlocked=false`。
- 退款回收或档位回退为 `QUOTA_10` 后，立即失效。
- 下一段不限额度会员期默认重新看广告解锁。

## 排障

- `1045`：当前账号不是有效不限额度会员。
- `1046`：广告凭证不存在、已领取、超过 5 分钟或跨会员到期窗口。
- 广告无法拉起：检查真实设备是否有广告填充、微信版本是否支持 `wx.createRewardedVideoAd`。
- 开发者工具不能代替真实广告验收。
- `rewarded_ad_attempts` 不存在时，先创建集合再重新发起广告。

## 回滚

- 客户端回滚：旧会员页不再展示广告解锁入口，但已写入的 `vibrationUnlockedUntil` 仍会在会员期内有效。
- 服务端回滚：不能只删除集合；如需立即统一上锁，应单独评估用户字段清理并取得明确授权。
- 不得通过删除 `users` 或批量写生产数据回滚。
