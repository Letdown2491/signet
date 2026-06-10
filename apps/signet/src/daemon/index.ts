import 'websocket-polyfill';
import { runDaemon } from './run.js';
import { logger } from './lib/logger.js';
import { toErrorMessage } from './lib/errors.js';
import type { DaemonBootstrapConfig } from './types.js';

process.on('message', (payload: DaemonBootstrapConfig) => {
    // A startup failure (port in use, DB/config error, key activation throw) must
    // exit non-zero so the supervisor restarts us — otherwise the rejection lands in
    // the global unhandledRejection handler, which logs and continues, leaving the
    // process alive but half-initialized (looks "up" while serving nothing).
    runDaemon(payload).catch((error) => {
        logger.error('Daemon failed to start', { error: toErrorMessage(error) });
        process.exit(1);
    });
});
