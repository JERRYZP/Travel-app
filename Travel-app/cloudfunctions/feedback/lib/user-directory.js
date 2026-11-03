/**
 * feedback 云函数专用的用户信息补全。
 *
 * 云函数按目录独立打包，不能 require 其它函数目录的文件，所以这里刻意复制了
 * payment/lib/admin-directory.js 的查表写法。复制的是「按 OpenID 批量查表」这个
 * 工具，不是会员 / 订单 / 售后那些业务规则 —— 反馈只关心昵称，不关心权益。
 * 分块大小和 openId 字段名由 test/feedback.test.js 钉住，两边不会悄悄漂移。
 */

const { COLLECTIONS } = require('./schema');

/** 单次 in 查询的 OpenID 数量上限（沿用 payment 侧已验证的 20） */
const USER_QUERY_CHUNK = 20;

/**
 * 批量按 OpenID 查用户，返回 { [openId]: user }。
 * users 文档缺失时对应 key 不存在，调用方自行兜底。
 */
async function userMapByOpenIds(db, openIds) {
  const ids = [...new Set((openIds || []).filter(Boolean))];
  const users = [];
  for (let index = 0; index < ids.length; index += USER_QUERY_CHUNK) {
    const chunk = ids.slice(index, index + USER_QUERY_CHUNK);
    const res = await db.collection(COLLECTIONS.USERS)
      .where({ openId: db.command.in(chunk) })
      .limit(chunk.length)
      .get();
    users.push(...(res.data || []));
  }
  return users.reduce((map, user) => {
    if (user.openId) map[user.openId] = user;
    return map;
  }, {});
}

/**
 * 管理端展示用的用户摘要。只有这三项，不要加会员字段。
 * 用户没有 users 文档时，nickname / avatarUrl 为空串，openId 用反馈上的 userId 兜底，
 * 保证管理员至少能拿到可检索的 OpenID。
 */
function userBriefOf(user = {}, fallbackOpenId = '') {
  return {
    openId: String(user.openId || fallbackOpenId || ''),
    nickname: String(user.nickname || ''),
    avatarUrl: String(user.avatarUrl || ''),
  };
}

module.exports = { USER_QUERY_CHUNK, userMapByOpenIds, userBriefOf };
