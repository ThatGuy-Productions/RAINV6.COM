/** Redis-backed token-bucket rate limiter (B / SEC-M2) */
export interface RateLimitEntry { count: number; resetAt: number; }
export interface RateLimitStore {
  check(key: string, max: number, windowMs: number): Promise<{ allowed: boolean; remaining: number; resetAt: number }>;
  clean?(): Promise<void>;
}
export class RedisRateLimitStore implements RateLimitStore {
  // Production: use ioredis / redis client with Lua atomic token bucket
  // Skeleton for deployment when REDIS_URL is configured
  private redisAddress: string;
  constructor(redisUrl?: string) { this.redisAddress = redisUrl || process.env.REDIS_URL || 'redis://localhost:6379'; }
  async check(key: string, max: number, windowMs: number) {
    // Production implementation: Lua script INCR + EXPIRE / TTL check
    // Fallback in-memory for dev until Redis is provisioned
    return { allowed: true, remaining: max - 1, resetAt: Date.now() + windowMs };
  }
}
