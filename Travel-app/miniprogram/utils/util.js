const formatTime = date => {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hour = date.getHours();
  const minute = date.getMinutes();
  const second = date.getSeconds();

  return `${[year, month, day].map(formatNumber).join('-')} ${[hour, minute, second].map(formatNumber).join(':')}`;
};

const formatNumber = n => {
  n = n.toString();
  return n[1] ? n : `0${n}`;
};

const formatDate = dateStr => {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${formatNumber(d.getMonth() + 1)}-${formatNumber(d.getDate())}`;
};

module.exports = {
  formatTime,
  formatDate,
  formatNumber,
};
