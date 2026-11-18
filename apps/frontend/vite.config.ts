import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // The browser talks only to Vite; API calls are forwarded to the backend, so the
    // backend needs no CORS setup in development.
    proxy: {
      '/api': 'http://localhost:4000',
    },
  },
});
