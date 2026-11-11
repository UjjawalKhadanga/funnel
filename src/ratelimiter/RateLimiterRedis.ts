import { Redis } from 'ioredis';
import { IRLConfig, Key } from '../interface.js';
import RedisConfigStore from '../configstore/RedisConfigStore.js';
import { rateLimitScript, ReturnCodes } from './lua/ratelimitscript.js';
import { Mutex } from 'async-mutex';

type Waiter = {
  resolve: () => void;
  reject: (error: Error) => void;
};

type KeyQueue = {
  waiters: Waiter[];
  draining: boolean;
  wake?: () => void;
};

type RateLimitDecision =
  | { status: 'allowed' }
  | { status: 'wait'; retryAfterMs: number }
  | { status: 'rejected'; message: string };

export type RateLimiterOptions = { maxPending?: number };
export type ConsumeOptions = { signal?: AbortSignal };

export default class RateLimiterRedis {
  private client: Redis;
  private configStore: RedisConfigStore;
  private scriptSha: string;
  private scriptLoadMutex: Mutex;
  private isScriptLoaded: boolean;
  private queues = new Map<Key, KeyQueue>();
  private closed = false;
  private pending = 0;
  private maxPending: number;

  constructor(client: Redis, options: RateLimiterOptions = {}) {
    this.maxPending = options.maxPending ?? 1000;
    if (!Number.isSafeInteger(this.maxPending) || this.maxPending < 1) {
      throw new Error('maxPending must be a positive integer');
    }
    // fully established connection should be passed
    this.client = client;
    this.configStore = new RedisConfigStore(client);
    this.scriptSha = '';
    this.isScriptLoaded = false;
    this.scriptLoadMutex = new Mutex(new Error('Failed to load rate limit script'));
  }

  async register(key: Key, config: IRLConfig) {
    if (!Number.isSafeInteger(config.points) || config.points < 1 ||
        !Number.isFinite(config.duration) || config.duration <= 0) {
      throw new Error('Invalid rate limit config');
    }
    await this.configStore.set(key, config);
  }

  private async checkAndLoadScript(): Promise<string> {
    await this.scriptLoadMutex.runExclusive(async () => {
      if (!this.isScriptLoaded) {
        this.scriptSha = await this.client.script('LOAD', rateLimitScript) as string;
        this.isScriptLoaded = true;
      }
    });
    return this.scriptSha;
  }

  async consume(key: Key, options: ConsumeOptions = {}): Promise<void> {
    if (this.closed) {
      throw new Error('Rate limiter disconnected');
    }

    const { signal } = options;
    if (signal?.aborted) throw new Error('Consume aborted');
    if (this.pending >= this.maxPending) throw new Error('Rate limiter queue full');
    const queue = this.queueFor(key);
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', abort);
        this.pending--;
        if (error) reject(error);
        else resolve();
      };
      const waiter: Waiter = { resolve: () => finish(), reject: (error) => finish(error) };
      const abort = () => {
        const index = queue.waiters.indexOf(waiter);
        if (index !== -1) queue.waiters.splice(index, 1);
        waiter.reject(new Error('Consume aborted'));
        queue.wake?.();
      };
      this.pending++;
      queue.waiters.push(waiter);
      signal?.addEventListener('abort', abort, { once: true });
      this.kick(key);
    });
  }

  async clear(key: Key): Promise<Boolean> {
    const deleteRes: number = await this.client.del(key);
    return deleteRes === 1;
  }

  private queueFor(key: Key): KeyQueue {
    let queue = this.queues.get(key);
    if (!queue) {
      queue = { waiters: [], draining: false };
      this.queues.set(key, queue);
    }
    return queue;
  }

  private kick(key: Key) {
    const queue = this.queues.get(key);
    if (!queue || queue.draining) return;
    queue.draining = true;
    void this.drain(key);
  }

  private rejectAll(queue: KeyQueue, error: Error) {
    queue.wake?.();
    const waiters = queue.waiters.splice(0);
    for (const waiter of waiters) waiter.reject(error);
  }

  private async drain(key: Key): Promise<void> {
    const queue = this.queues.get(key);
    if (!queue) return;

    try {
      while (queue.waiters.length > 0) {
        if (this.closed) {
          this.rejectAll(queue, new Error('Rate limiter disconnected'));
          return;
        }

        const waiter = queue.waiters[0];
        const decision = await this.checkRateLimit(key);
        if (queue.waiters[0] !== waiter) continue;
        if (decision.status === 'allowed') {
          queue.waiters.shift()?.resolve();
          continue;
        }
        if (decision.status === 'wait') {
          await new Promise<void>((resolve) => {
            const wake = () => {
              clearTimeout(timer);
              queue.wake = undefined;
              resolve();
            };
            const timer = setTimeout(wake, Math.min(decision.retryAfterMs, 2147483647));
            queue.wake = wake;
          });
          continue;
        }

        this.rejectAll(queue, new Error(decision.message));
        return;
      }
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      this.rejectAll(queue, normalized);
    } finally {
      queue.draining = false;
      if (queue.waiters.length > 0) {
        this.kick(key);
      } else {
        this.queues.delete(key);
      }
    }
  }

  private parseScriptResult(result: unknown): RateLimitDecision {
    const values = Array.isArray(result) ? result : [result, 0];
    const code = Number(values[0]);
    const retryAfterMs = Number(values[1] ?? 0);

    if (code === ReturnCodes.SUCCESS) return { status: 'allowed' };
    if (code === ReturnCodes.RATE_LIMIT_EXCEEDED) {
      const waitMs = Number.isFinite(retryAfterMs) && retryAfterMs > 0 ? retryAfterMs : 1;
      return { status: 'wait', retryAfterMs: waitMs };
    }
    if (code === ReturnCodes.NO_CONFIG) {
      return { status: 'rejected', message: `No rate limit config for key` };
    }
    if (code === ReturnCodes.INVALID_CONFIG) {
      return { status: 'rejected', message: 'Invalid rate limit config' };
    }
    return { status: 'rejected', message: `Unexpected rate limit result: ${code}` };
  }

  private async checkIfRequestCanGoThrough(keyName: Key): Promise<RateLimitDecision> {
    const scriptResult = await this.client.evalsha(this.scriptSha, 1, keyName);
    return this.parseScriptResult(scriptResult);
  }

  private async checkRateLimit(keyName: Key): Promise<RateLimitDecision> {
    if (!this.isScriptLoaded) await this.checkAndLoadScript();
    try {
      return await this.checkIfRequestCanGoThrough(keyName);
    } catch (err: any) {
      if (err.message.includes('NOSCRIPT')) {
        // Script was flushed from Redis, reload it
        this.isScriptLoaded = false;
        await this.checkAndLoadScript();
        return await this.checkIfRequestCanGoThrough(keyName);
      }
      throw err;
    }
  }

  async cleanup(): Promise<void> {
    try {
      await this.configStore.clear();
      this.isScriptLoaded = false;
      this.scriptSha = '';
    } catch (error) {
      throw new Error(`Cleanup failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async disconnect(): Promise<void> {
    this.closed = true;
    for (const queue of this.queues.values()) {
      this.rejectAll(queue, new Error('Rate limiter disconnected'));
    }
    this.queues.clear();
    try {
      await this.cleanup();
    } finally {
      await this.client.quit();
    }
  }
}