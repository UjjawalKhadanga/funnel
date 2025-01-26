import { Redis } from "ioredis";
import { IRLConfigStore, IRLConfig } from "../interface.js";
import { RL_CONFIG_STORE_KEY } from "../config.js";

class RedisConfigStore implements IRLConfigStore {
  private client: Redis;
  private storeKey: string;
  private isReady: Boolean;

  constructor(client: Redis) {
    this.client = client;
    this.storeKey = RL_CONFIG_STORE_KEY;
    this.isReady = false;
  }

  _parseConfig(configStr: string): IRLConfig | null {
    try {
      return JSON.parse(configStr);
    } catch (e) {
      console.error(`[RedisConfigStore] Error while parsing the redis config ${configStr}`);
      return null;
    }
  }

  async setup(): Promise<void> {
    // Create a redis JSON with the key as the config name and the value as the config object
    await this.client.call('JSON.SET', this.storeKey, '$', JSON.stringify({}), 'NX');
    this.isReady = true;
  }

  async get(key: string): Promise<IRLConfig | null> {
    const configStr: string | null = await this.client.call('JSON.GET', this.storeKey, `$.${key}`) as (string | null);
    if (!configStr) return null;
    const config: IRLConfig | null = this._parseConfig(configStr);
    if (!config) return null;
    return config;
  }

  async set(key: string, config: IRLConfig): Promise<void> {
    if (!this.isReady) await this.setup();
    await this.client.call('JSON.SET', this.storeKey, `$.${key}`, JSON.stringify(config));
  }

  async delete(key: string): Promise<void> {
    await this.client.call('JSON.DEL', this.storeKey, `$.${key}`);
  }

  async clear(): Promise<void> {
    await this.client.call('JSON.DEL', this.storeKey, '$');
  }

  async has(key: string): Promise<boolean> {
    const exists = await this.client.call('JSON.TYPE', this.storeKey, `$.${key}`);
    return exists !== 'null';
  }

  async keys(): Promise<string[]> {
    const allKeys: string[] = await this.client.call('JSON.GET', this.storeKey, '$.*') as string[];
    return allKeys;
  }
}

export default RedisConfigStore;