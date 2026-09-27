import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The API runs on 5174; proxying /api means the browser only ever talks to one
// origin, so there is no CORS story to explain during a demo.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://localhost:5174', changeOrigin: true } },
  },
});
