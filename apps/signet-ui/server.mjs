import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Support both new (UI_*) and legacy (PORT/HOST) env var names
const port = Number.parseInt(process.env.UI_PORT ?? process.env.PORT ?? '4174', 10);
const host = process.env.UI_HOST ?? process.env.HOST ?? '0.0.0.0';
const daemonUrl = process.env.DAEMON_URL ?? 'http://localhost:3000';

// Shared error handler for proxies
const onProxyError = (err, req, res) => {
  if (res.headersSent) return;
  res.status(502).json({
    ok: false,
    error: `Proxy error: ${err instanceof Error ? err.message : 'unknown error'}`
  });
};

// API paths to proxy
const apiPaths = [
  '/requests',
  '/register',
  '/connection',
  '/connections',
  '/relays',
  '/keys',
  '/apps',
  '/dashboard',
  '/health',
  '/logs',
  '/tokens',
  '/policies',
  '/csrf-token',
  '/nostrconnect',
  '/dead-man-switch'
];

// SSE proxy for /events endpoint (no timeout, streaming)
const sseProxy = createProxyMiddleware({
  target: daemonUrl,
  changeOrigin: true,
  proxyTimeout: 0,
  timeout: 0,
  pathFilter: '/events',
  on: {
    proxyReq(proxyReq) {
      proxyReq.setHeader('Accept', 'text/event-stream');
      proxyReq.setHeader('Cache-Control', 'no-cache');
      proxyReq.setHeader('Connection', 'keep-alive');
    },
    proxyRes(proxyRes) {
      proxyRes.headers['x-accel-buffering'] = 'no';
      proxyRes.headers['cache-control'] = 'no-cache, no-transform';
    },
    error: onProxyError
  }
});

// API proxy for standard endpoints
const apiProxy = createProxyMiddleware({
  target: daemonUrl,
  changeOrigin: true,
  proxyTimeout: 10_000,
  pathFilter: apiPaths,
  on: {
    error: onProxyError
  }
});

// Mount proxies at root - pathFilter handles routing
app.use(sseProxy);
app.use(apiProxy);

// Serve static files
const distDir = path.join(__dirname, 'dist');
app.use(express.static(distDir));

// SPA fallback - serve index.html for all other routes
app.get('*', (_req, res) => {
  res.sendFile(path.join(distDir, 'index.html'));
});

app.listen(port, host, () => {
  console.log(`Signet UI listening on http://${host}:${port} (proxying ${daemonUrl})`);
});
