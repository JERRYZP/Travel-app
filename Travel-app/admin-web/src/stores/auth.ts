import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { callAdmin } from '../api/client';
import type { AdminProfile, LoginResult } from '../types';

const TOKEN_KEY = 'travel-admin-token';
const ADMIN_KEY = 'travel-admin-profile';

function readJSON<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : null;
  } catch {
    return null;
  }
}

export const useAuthStore = defineStore('auth', () => {
  const token = ref<string>(sessionStorage.getItem(TOKEN_KEY) || '');
  const admin = ref<AdminProfile | null>(readJSON<AdminProfile>(ADMIN_KEY));
  const isAuthenticated = computed(() => Boolean(token.value && admin.value));

  async function login(username: string, password: string) {
    const res = await callAdmin<LoginResult>('admin.login', { username, password });
    token.value = String(res.token || '');
    admin.value = res.admin as AdminProfile;
    sessionStorage.setItem(TOKEN_KEY, token.value);
    sessionStorage.setItem(ADMIN_KEY, JSON.stringify(admin.value));
  }

  function logout() {
    token.value = '';
    admin.value = null;
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(ADMIN_KEY);
  }

  return { token, admin, isAuthenticated, login, logout };
});
