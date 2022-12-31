import Redis from 'ioredis';

export default class RedisHelper {
  private readonly redis: Redis;

  constructor(redis: Redis) {
    this.redis = redis;
  }

  public async set<T>(table: string, key: string, value: T): Promise<void> {
    await this.redis.hset(table, key, JSON.stringify(value));
  }

  public async get<T>(table: string, key: string): Promise<T | null> {
    const value = await this.redis.hget(table, key);
    if (value === null) return null;

    return JSON.parse(value) as T;
  }

  public async delete(table: string, key: string): Promise<void> {
    await this.redis.hdel(table, key);
  }

  public async hgetall<T>(table: string): Promise<T[]> {
    const items = await this.redis.hgetall(table);
    const result: T[] = [];

    for (const key in items) {
      result.push(JSON.parse(items[key]) as T);
    }

    return result;
  }

  public async publish(
    channel: string,
    payload: any,
    receiverSocketId?: string
  ): Promise<void> {
    if (receiverSocketId !== undefined) {
      payload.receiverSocketId = receiverSocketId;
    }
    await this.redis.publish(channel, JSON.stringify(payload));
  }
}
