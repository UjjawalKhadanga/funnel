import RateLimiterRedis from "../src/ratelimiter/RateLimiterRedis.js";
import Redis from "ioredis";
import { expect } from "chai";
import { RL_CONFIG_STORE_KEY } from "../src/config.js";

async function runMultipleExecutionsParallely(func: Function, times: number) {
  return Promise.all(Array.from({ length: times }, () => func()));
}


describe("RateLimiterRedis", () => {
  let rateLimiter: RateLimiterRedis;
  let client: Redis;

  after(async () => { await rateLimiter.disconnect(); });

  before(() => {
    client = new Redis();
    rateLimiter = new RateLimiterRedis(client);
  });

  it('should be able to correctly register a config', async () => {
    const key = 'test1';
    const rlConfig = { points: 10, duration: 5 };
    await rateLimiter.register(key, rlConfig);
    const configInRedis = await client.call('JSON.GET', RL_CONFIG_STORE_KEY, `$.${key}`);
    const parsedConfig = JSON.parse(configInRedis as string)[0];
    expect(parsedConfig).to.deep.equal(rlConfig);
  });

  it('should admit requests up to the point limit immediately', async () => {
    const key = 'test2';
    const rlConfig = { points: 5, duration: 60 };
    await rateLimiter.register(key, rlConfig);
    await runMultipleExecutionsParallely(
      () => rateLimiter.consume(key),
      rlConfig.points,
    );
    await rateLimiter.clear(key);
  });

  it('should resolve a queued consume once a slot opens', async () => {
    const key = 'test3';
    const rlConfig = { points: 1, duration: 1 };
    await rateLimiter.register(key, rlConfig);

    await rateLimiter.consume(key);

    let resolved = false;
    const started = Date.now();
    const queued = rateLimiter.consume(key).then(() => {
      resolved = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(resolved).to.equal(false);

    await queued;
    expect(Date.now() - started).to.be.greaterThanOrEqual(900);
    await rateLimiter.clear(key);
  });

  it('should resolve queued consumes in arrival order', async () => {
    const key = 'test4';
    await rateLimiter.register(key, { points: 1, duration: 1 });

    const order: number[] = [];
    const consumes = [1, 2, 3].map((n) =>
      rateLimiter.consume(key).then(() => order.push(n)),
    );

    await Promise.all(consumes);
    expect(order).to.deep.equal([1, 2, 3]);
    await rateLimiter.clear(key);
  });

  it('should reject consume when the key has no config', async () => {
    try {
      await rateLimiter.consume('missing-key');
      expect.fail('consume should reject');
    } catch (error) {
      expect((error as Error).message).to.equal('No rate limit config for key');
    }
  });
  it('should reload the script after Redis flushes it', async () => {
    await rateLimiter.register('reload', { points: 2, duration: 1 });
    await rateLimiter.consume('reload');
    await client.script('FLUSH');
    await rateLimiter.consume('reload');
    await rateLimiter.clear('reload');
  });

  it('should reject invalid configs before storing them', async () => {
    for (const config of [
      { points: 0, duration: 1 }, { points: 1.5, duration: 1 },
      { points: 1, duration: 0 }, { points: 1, duration: Infinity },
    ]) {
      const error = await rateLimiter.register('invalid', config).then(() => null, e => e);
      expect(error?.message).to.equal('Invalid rate limit config');
    }
  });

  it('should bound pending work and release capacity after cancellation', async () => {
    const limited = new RateLimiterRedis(new Redis(), { maxPending: 1 });
    try {
      await limited.register('cancel', { points: 1, duration: 60 });
      await limited.consume('cancel');
      const controller = new AbortController();
      const pending = limited.consume('cancel', { signal: controller.signal }).catch(e => e);
      const full = await limited.consume('cancel').catch(e => e);
      expect(full.message).to.equal('Rate limiter queue full');
      controller.abort();
      expect((await pending).message).to.equal('Consume aborted');
      await limited.clear('cancel');
      await limited.consume('cancel');
      await limited.clear('cancel');
    } finally {
      await limited.disconnect();
    }
  });

  it('should reject waiting work and cancel its timer on disconnect', async () => {
    const limited = new RateLimiterRedis(new Redis());
    await limited.register('shutdown', { points: 1, duration: 60 });
    await limited.consume('shutdown');
    const pending = limited.consume('shutdown').catch(e => e);
    await new Promise(resolve => setTimeout(resolve, 50));
    await limited.clear('shutdown');
    await limited.disconnect();
    expect((await pending).message).to.equal('Rate limiter disconnected');
    const error = await limited.consume('shutdown').catch(e => e);
    expect(error.message).to.equal('Rate limiter disconnected');
  });

})