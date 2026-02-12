/// <reference types="vitest" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { config as dotenvConfig } from 'dotenv';

// Load .env from repository root (two levels up)
dotenvConfig({ path: resolve(__dirname, '../../.env') });

const packageJson = JSON.parse(readFileSync('./package.json', 'utf-8'));

function basicAuthPlugin(): Plugin {
  return {
    name: 'basic-auth',
    configureServer(server) {
      const username = process.env.UI_AUTH_USERNAME;
      const password = process.env.UI_AUTH_PASSWORD;
      if (!username || !password) return;

      console.log('Basic Auth enabled for dev server');

      server.middlewares.use((req, res, next) => {
        const header = req.headers.authorization;
        if (header) {
          const match = header.match(/^Basic\s+(.+)$/);
          if (match) {
            const [user, pass] = Buffer.from(match[1], 'base64').toString().split(':');
            if (user === username && pass === password) {
              return next();
            }
          }
        }
        res.setHeader('WWW-Authenticate', 'Basic realm="Signet UI"');
        res.statusCode = 401;
        res.end('Authentication required');
      });
    },
  };
}

export default defineConfig({
  plugins: [basicAuthPlugin(), react()],
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Split large vendor libraries into separate chunks
          'vendor-react': ['react', 'react-dom'],
          'vendor-qr': ['qrcode.react', 'html5-qrcode'],
          'vendor-nostr': ['nostr-tools'],
        },
      },
    },
  },
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
      },
      '/connections': {
        target: 'http://localhost:3000',
        changeOrigin: true
      },
      '/relays': {
        target: 'http://localhost:3000',
        changeOrigin: true
      },
      '/keys': {
        target: 'http://localhost:3000',
        changeOrigin: true
      },
      '/apps': {
        target: 'http://localhost:3000',
        changeOrigin: true
      },
      '/dashboard': {
        target: 'http://localhost:3000',
        changeOrigin: true
      },
      '/events': {
        target: 'http://localhost:3000',
        changeOrigin: true
      },
      '/tokens': {
        target: 'http://localhost:3000',
        changeOrigin: true
      },
      '/policies': {
        target: 'http://localhost:3000',
        changeOrigin: true
      },
      '/csrf-token': {
        target: 'http://localhost:3000',
        changeOrigin: true
      },
      '/health': {
        target: 'http://localhost:3000',
        changeOrigin: true
      },
      '/logs': {
        target: 'http://localhost:3000',
        changeOrigin: true
      },
      '/nostrconnect': {
        target: 'http://localhost:3000',
        changeOrigin: true
      },
      '/dead-man-switch': {
        target: 'http://localhost:3000',
        changeOrigin: true
      }
    }
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/testing/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/hooks/**', 'src/components/**'],
      exclude: ['**/*.test.{ts,tsx}', '**/index.ts'],
    },
  },
});
