export function maskId(value: unknown): string {
  const s = String(value ?? '');
  if (s.length <= 8) return s ? `${s.slice(0, 2)}****` : '';
  return `${s.slice(0, 4)}****${s.slice(-4)}`;
}

export function maskPhone(value: unknown): string {
  const s = String(value ?? '');
  if (!s) return '';
  if (s.length < 7) return '****';
  return `${s.slice(0, 3)}****${s.slice(-4)}`;
}

export function maskNickname(value: unknown): string {
  const s = String(value ?? '');
  if (!s) return '';
  if (s.length <= 2) return `${s.slice(0, 1)}*`;
  return `${s.slice(0, 1)}**${s.slice(-1)}`;
}
