import cloudbase from '@cloudbase/js-sdk';
import type { ApiResponse } from '../types';

const ENV_ID = import.meta.env.VITE_CLOUDBASE_ENV || 'cloud1-d9g9f4hja396d6e92';
let app: ReturnType<typeof cloudbase.init> | null = null;
let authReady: Promise<void> | null = null;

function ensureApp() {
  if (!app) app = cloudbase.init({ env: ENV_ID });
  return app;
}

async function ensureAuth() {
  const current = ensureApp();
  if (!authReady) {
    authReady = current.auth().signInAnonymously().then(({ error }) => {
      if (error) throw new Error(error.message || 'CloudBase 匿名登录失败');
    });
  }
  return authReady;
}

export class AdminApiError extends Error {
  errorCode?: number;
  constructor(message: string, errorCode?: number) {
    super(message);
    this.name = 'AdminApiError';
    this.errorCode = errorCode;
  }
}

export async function callAdmin<T>(action: string, payload: Record<string, unknown> = {}, token?: string) {
  await ensureAuth();
  const res = await ensureApp().callFunction({
    name: 'admin',
    data: { action, ...payload, ...(token ? { token } : {}) },
    parse: true,
  });
  if (res.code || res.message) throw new AdminApiError(res.message || '云函数调用失败');
  const result = res.result as ApiResponse<T>;
  if (!result || result.success !== true) {
    throw new AdminApiError(result?.error || '请求失败', result?.errorCode);
  }
  return result as ApiResponse<T> & T;
}
