/** 管理后台敏感字段脱敏。列表默认只使用这里的结果。 */
function maskId(value) {
  const s = String(value || '');
  if (s.length <= 8) return s ? `${s.slice(0, 2)}****` : '';
  return `${s.slice(0, 4)}****${s.slice(-4)}`;
}

function maskPhone(value) {
  const s = String(value || '');
  if (!s) return '';
  if (s.length < 7) return '****';
  return `${s.slice(0, 3)}****${s.slice(-4)}`;
}

function maskNickname(value) {
  const s = String(value || '');
  if (!s) return '';
  if (s.length <= 2) return `${s.slice(0, 1)}*`;
  return `${s.slice(0, 1)}**${s.slice(-1)}`;
}

module.exports = { maskId, maskPhone, maskNickname };
