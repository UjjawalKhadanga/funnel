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

  it('should be able to rate limit correctly', async () => {
    const key = 'test2';
    const rlConfig = { points: 5, duration: 60 };
    await rateLimiter.register(key, rlConfig);
    const validReqResults = await runMultipleExecutionsParallely(
      () => rateLimiter.consume(key),
      rlConfig.points,
    );
    const ivalidReqResults = await rateLimiter.consume(key);
    validReqResults.map(res => expect(res).to.be.true);
    expect(ivalidReqResults).to.be.false;
    await rateLimiter.clear(key);
  });
})