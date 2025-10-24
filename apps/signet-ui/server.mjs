import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

const port = Number.parseInt(process.env.PORT ?? '4174', 10);
const host = process.env.HOST ?? '0.0.0.0';
const daemonUrl = process.env.DAEMON_URL ?? 'http://signet:3000';

const apiProxy = createProxyMiddleware(['/requests', '/register', '/connection'], {
  target: daemonUrl,
  changeOrigin: true,
  ws: false,
  proxyTimeout: 10_000,
  onError(err, req, res) {
    if (res.headersSent) {
      return;
    }

    res
      .status(502)
      .json({
        ok: false,
        error: `Proxy error: ${err instanceof Error ? err.message : 'unknown error'}`
      });
  }
});

app.use(apiProxy);

const distDir = path.join(__dirname, 'dist');
app.use(express.static(distDir));

app.get('*', (_req, res) => {
  res.sendFile(path.join(distDir, 'index.html'));
});

app.listen(port, host, () => {
  console.log(`Signet UI listening on http://${host}:${port} (proxying ${daemonUrl})`);
});
