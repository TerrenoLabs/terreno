import {beforeAll, describe, it, mock} from "bun:test";
import {assert} from "chai";

mock.module("ioredis", () => {
  class Redis {
    incr = async (_key: string): Promise<number> => 1;
    pexpire = async (_key: string, _milliseconds: number): Promise<number> => 1;
    pttl = async (_key: string): Promise<number> => 5_000;
  }
  return {default: Redis};
});

let createRedisRateLimitStore: typeof import("./redisStore.js").createRedisRateLimitStore;

describe("redis rate limit store ioredis loader", () => {
  beforeAll(async () => {
    ({createRedisRateLimitStore} = await import("./redisStore.js"));
    process.env.REDIS_URL = "redis://127.0.0.1:6379";
    Reflect.deleteProperty(process.env, "VALKEY_URL");
  });

  it("consumes using a dynamically imported ioredis client", async () => {
    const store = createRedisRateLimitStore();
    const first = await store.consume({key: "dyn", max: 5, now: 1, windowMs: 15_000});
    const second = await store.consume({key: "dyn", max: 5, now: 2, windowMs: 15_000});
    assert.isTrue(first.allowed);
    assert.isTrue(second.allowed);
    assert.equal(first.resetAt, 1 + 5_000);
  });
});
