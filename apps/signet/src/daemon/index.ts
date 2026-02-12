import { resolve } from 'path';

// Load .env from repository root (three levels up from this file's location) in development
// In production (NODE_ENV=production), dotenv may not be installed
if (process.env.NODE_ENV !== 'production') {
  try {
    // Use require for synchronous loading to avoid top-level await
    const dotenv = require('dotenv');
    dotenv.config({ path: resolve(__dirname, '../../../../.env') });
  } catch {
    // dotenv not available, skip .env loading (production mode)
  }
}

import 'websocket-polyfill';
import { runDaemon } from './run.js';
import type { DaemonBootstrapConfig } from './types.js';

process.on('message', (payload: DaemonBootstrapConfig) => {
    runDaemon(payload);
});
