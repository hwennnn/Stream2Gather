import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const api = process.env.API_URL ?? 'http://127.0.0.1:18080';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/v1': { target: api, ws: true },
    },
  },
  test: { environment: 'node' },
});
