import { IRLConfigStore, IRLConfig } from "../interface.js";

class MemoryConfigStore implements IRLConfigStore {
  private store: Record<string, IRLConfig>;

  constructor() {
    this.store = {};
  }

  get(key: string): Promise<IRLConfig> {
    return new Promise((resolve, reject) => {
      if (this.store[key]) {
        resolve(this.store[key]);
      } else {
        reject(new Error(`Config ${key} not found`));
      }
    })
  }

  set(key: string, config: IRLConfig): Promise<void> {
    return new Promise((resolve, reject) => {
      this.store[key] = config;
      resolve();
    });
  }

  delete(key: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.store[key]) {
        delete this.store[key];
        resolve();
      } else {
        reject(new Error(`Config ${key} not found`));
      }
    });
  }

  clear(): Promise<void> {
    return new Promise((resolve) => {
      this.store = {};
      resolve();
    });
  }

  has(key: string): Promise<boolean> {
    return new Promise((resolve) => {
      resolve(!!this.store[key]);
    })
  }

  keys(): Promise<string[]> {
    return new Promise((resolve) => {
      resolve(Object.keys(this.store));
    });
  }
}

export default MemoryConfigStore;