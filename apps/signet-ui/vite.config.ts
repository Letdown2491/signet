import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 4174,
    host: '0.0.0.0',
    proxy: {
      '/requests': {
        target: 'http://localhost:3000',
        changeOrigin: true
      },
      '/register': {
        target: 'http://localhost:3000',
        changeOrigin: true
      },
      '/connection': {
        target: 'http://localhost:3000',
        changeOrigin: true
      }
    }
  }
});
