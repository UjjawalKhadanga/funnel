interface IRLConfig {
  points: number;
  duration: number;
}

interface IRLConfigStore {
  get(key: string): Promise<IRLConfig | null>;
  set(key: string, value: IRLConfig): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
  has(key: string): Promise<boolean>;
  keys(): Promise<string[]>;
}

export { IRLConfig, IRLConfigStore };
