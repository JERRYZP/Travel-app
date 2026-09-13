/* wx-server-sdk 测试桩
 *
 * spots 云函数的纯函数区（_internal 导出）不碰云 API，但模块顶层会 require
 * wx-server-sdk。测试环境没有该依赖，用此桩替代，只为让 require 成功。
 */
module.exports = {
  init() { return {}; },
  database() { return { collection: () => ({}) }; },
  DYNAMIC_CURRENT_ENV: 'test',
};
