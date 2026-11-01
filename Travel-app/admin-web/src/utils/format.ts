export function formatDateTime(value: unknown): string {
  if (!value) return '-';
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

export function formatDate(value: unknown): string {
  if (!value) return '-';
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function formatPercent(value: number | null | undefined): string {
  return value == null ? '-' : `${value.toFixed(1)}%`;
}

export function statusLabel(status: unknown): string {
  const key = String(status ?? '');
  const labels: Record<string, string> = {
    WAITING: '待处理',
    TRIGGERED: '已触发',
    MISSED: '未送达',
    CLOSED: '已关闭',
  };
  return labels[key] || key || '-';
}

export function statusTagType(status: unknown): 'info' | 'success' | 'danger' | 'warning' {
  const key = String(status ?? '');
  if (key === 'TRIGGERED') return 'success';
  if (key === 'MISSED') return 'danger';
  if (key === 'WAITING') return 'warning';
  return 'info';
}
