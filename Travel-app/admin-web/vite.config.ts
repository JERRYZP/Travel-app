import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  base: './',
  plugins: [vue()],
  server: { port: 5174 },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
