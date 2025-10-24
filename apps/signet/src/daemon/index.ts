import 'websocket-polyfill';
import { runDaemon } from './run.js';
import type { DaemonBootstrapConfig } from './types.js';

process.on('message', (payload: DaemonBootstrapConfig) => {
    runDaemon(payload);
});
