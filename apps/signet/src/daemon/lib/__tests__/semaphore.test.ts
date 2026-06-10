import { describe, it, expect } from 'vitest';
import { Semaphore } from '../semaphore.js';

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5));

describe('Semaphore', () => {
  it('caps the number of concurrent run() executions', async () => {
    const sem = new Semaphore(2);
    let active = 0;
    let maxActive = 0;

    const task = async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await tick();
      active--;
    };

    await Promise.all(Array.from({ length: 6 }, () => sem.run(task)));

    expect(maxActive).toBe(2);
    expect(sem.available).toBe(2); // all permits returned
  });

  it('hands a released permit to the next waiter', async () => {
    const sem = new Semaphore(1);
    await sem.acquire();

    let acquired = false;
    const waiting = sem.acquire().then(() => {
      acquired = true;
    });

    await tick();
    expect(acquired).toBe(false); // no permit available yet

    sem.release();
    await waiting;
    expect(acquired).toBe(true);
  });

  it('releases the permit even when the wrapped fn throws', async () => {
    const sem = new Semaphore(1);
    await expect(
      sem.run(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(sem.available).toBe(1);
  });
});
