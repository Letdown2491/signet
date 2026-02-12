import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import auth from 'basic-auth';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from repository root (two levels up) in development
// In production (NODE_ENV=production), dotenv may not be installed
if (process.env.NODE_ENV !== 'production') {
  try {
    const { config } = await import('dotenv');
    config({ path: path.resolve(__dirname, '../../.env') });
  } catch {
    // dotenv not available, skip .env loading (production mode)
  }
}

const app = express();

// Support both new (UI_*) and legacy (PORT/HOST) env var names
const port = Number.parseInt(process.env.UI_BIND_PORT ?? process.env.PORT ?? '4174', 10);
const host = process.env.UI_BIND_ADDRESS ?? '0.0.0.0';
const signetHost = process.env.SIGNET_HOST ?? 'localhost';
const signetPort = process.env.SIGNET_PORT ?? '3000';
const signetUrl = process.env.SIGNET_URL ?? `http://${signetHost}:${signetPort}`;

// Basic auth configuration (disabled by default)
const authUsername = process.env.UI_AUTH_USERNAME;
const authPassword = process.env.UI_AUTH_PASSWORD;
const isAuthEnabled = authUsername && authPassword;

// Rate limiting for basic auth failures (prevent brute force)
// Allows 10 failed attempts per 15 minutes per IP
const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts
  skipSuccessfulRequests: true, // Only count failed auth attempts
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers
  handler: (req, res) => {
    res.status(429).send('Too many failed authentication attempts. Please try again later.');
  },
});

// Load API token from environment variable
const apiToken = process.env.SIGNET_API_TOKEN;
if (apiToken) {
  console.log('✓ Using API token from SIGNET_API_TOKEN environment variable');
} else {
  console.warn('⚠️  No SIGNET_API_TOKEN set - requests to daemon may fail if authentication is required');
}

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
  target: signetUrl,
  changeOrigin: true,
  proxyTimeout: 0,
  timeout: 0,
  pathFilter: '/events',
  on: {
    proxyReq(proxyReq) {
      proxyReq.setHeader('Accept', 'text/event-stream');
      proxyReq.setHeader('Cache-Control', 'no-cache');
      proxyReq.setHeader('Connection', 'keep-alive');
      if (apiToken) {
        proxyReq.setHeader('X-API-Token', apiToken);
      }
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
  target: signetUrl,
  changeOrigin: true,
  proxyTimeout: 10_000,
  pathFilter: apiPaths,
  on: {
    proxyReq(proxyReq) {
      if (apiToken) {
        proxyReq.setHeader('X-API-Token', apiToken);
      }
    },
    error: onProxyError
  }
});

// Basic authentication middleware with rate limiting
if (isAuthEnabled) {
  // Apply rate limiter first
  //app.use(authRateLimiter);

  // Then check credentials
  app.use((req, res, next) => {
    const credentials = auth(req);

    if (!credentials || credentials.name !== authUsername || credentials.pass !== authPassword) {
      res.set('WWW-Authenticate', 'Basic realm="Signet UI"');
      return res.status(401).send('Authentication required');
    }

    next();
  });
}

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
  const authStatus = isAuthEnabled ? ' [Basic Auth Enabled]' : '';
  console.log(`Signet UI listening on http://${host}:${port} (proxying ${signetUrl})${authStatus}`);
});
