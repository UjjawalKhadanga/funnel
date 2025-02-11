type IRLConfig = {
  points: number;
  duration: number;
}

type Key = string;

interface IRLConfigStore {
  get(key: Key): Promise<IRLConfig | null>;
  set(key: Key, value: IRLConfig): Promise<void>;
  delete(key: Key): Promise<void>;
  clear(): Promise<void>;
  has(key: Key): Promise<boolean>;
  keys(): Promise<Key[]>;
}

export { IRLConfig, IRLConfigStore, Key };
