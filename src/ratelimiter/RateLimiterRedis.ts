import { Redis } from 'ioredis';
import { IRLConfig, IRLConfigStore } from '../interface.js';
import RedisConfigStore from '../configstore/RedisConfigStore.js';
import { rateLimitScript, ReturnCodes } from './lua/ratelimitscript.js';
import { Mutex } from 'async-mutex';

export default class RateLimiterRedis {
  private client: Redis;
  private configStore: IRLConfigStore;
  private scriptSha: string;
  private scriptLoadMutex: Mutex;
  private isScriptLoaded: boolean;

  constructor(client: Redis) {
    // fully established connection should be passed
    this.client = client;
    this.configStore = new RedisConfigStore(client);
    this.scriptSha = '';
    this.isScriptLoaded = false;
    this.scriptLoadMutex = new Mutex(new Error('Chud gye guru'));
  }

  async register(key: string, config: IRLConfig) {
    await this.configStore.set(key, config);
  }

  private async checkAndLoadScript(): Promise<string> {
    await this.scriptLoadMutex.runExclusive(async () => {
      if (!this.isScriptLoaded) {
        this.scriptSha = await this.client.script('LOAD', rateLimitScript) as string;
        this.isScriptLoaded = true;
      }
    }).catch(err => new Error('Failed to load rate limit script'))
    return this.scriptSha;
  }

  async consume(key: string): Promise<Boolean> {
    const result = await this.checkRateLimit(key);
    console.log(`${key}: ${result}`)
    return result;
  }

  async clear(key: string): Promise<Boolean> {
    const deleteRes: number = await this.client.del(key);
    return deleteRes === 1;
  }

  private async checkIfRequestCanGoThrough(keyName: string): Promise<Boolean> {
    const scriptResult = await this.client.evalsha(this.scriptSha, 1, keyName);
    if (scriptResult === ReturnCodes.SUCCESS) return true;
    console.log(ReturnCodes[scriptResult as number]);
    return false;
  }

  private async checkRateLimit(keyName: string) {
    if (!this.isScriptLoaded) await this.checkAndLoadScript();
    try {
      return this.checkIfRequestCanGoThrough(keyName);
    } catch (err: any) {
      if (err.message.includes('NOSCRIPT')) {
        // Script was flushed from Redis, reload it
        this.isScriptLoaded = false;
        await this.checkAndLoadScript();
        return this.checkIfRequestCanGoThrough(keyName);
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
    await this.cleanup();
    await this.client.quit();
  }
}