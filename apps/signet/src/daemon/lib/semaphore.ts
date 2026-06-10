/**
 * Minimal async counting semaphore.
 *
 * Bounds how many async operations run at once. Used to cap the number of
 * concurrent relay publishes so a burst of NIP-46 requests can't fire hundreds
 * of EVENT frames at the relay sockets simultaneously (which is what trips
 * relay "too many events, slow down" limits and causes publish timeouts).
 */
export class Semaphore {
    private permits: number;
    private readonly waiters: Array<() => void> = [];

    constructor(permits: number) {
        if (permits < 1) {
            throw new Error('Semaphore requires at least 1 permit');
        }
        this.permits = permits;
    }

    /** Acquire a permit, waiting if none are available. */
    async acquire(): Promise<void> {
        if (this.permits > 0) {
            this.permits--;
            return;
        }
        await new Promise<void>((resolve) => this.waiters.push(resolve));
    }

    /** Release a permit, waking the next waiter (if any). */
    release(): void {
        const next = this.waiters.shift();
        if (next) {
            // Hand the permit directly to the next waiter without incrementing,
            // keeping the in-flight count at the configured ceiling.
            next();
        } else {
            this.permits++;
        }
    }

    /** Run `fn` while holding a permit, releasing it even if `fn` throws. */
    async run<T>(fn: () => Promise<T>): Promise<T> {
        await this.acquire();
        try {
            return await fn();
        } finally {
            this.release();
        }
    }

    /** Number of permits currently available (for tests/diagnostics). */
    get available(): number {
        return this.permits;
    }
}
