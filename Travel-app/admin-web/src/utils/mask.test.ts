import { describe, expect, it } from 'vitest';
import { maskId, maskNickname, maskPhone } from './mask';

describe('mask helpers', () => {
  it('masks identifiers without exposing the middle', () => {
    expect(maskId('oZ6IFxvYK1mKzBaehMcOPIl_CgN0')).toBe('oZ6I****CgN0');
    expect(maskPhone('13800138000')).toBe('138****8000');
    expect(maskNickname('用户abcdef')).toBe('用**f');
  });
});
