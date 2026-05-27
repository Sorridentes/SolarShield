class CacheService {
  constructor(redis, fetcher, ttlSeconds = 300) {
    this.redis = redis;
    this.fetcher = fetcher;
    this.ttl = ttlSeconds;
  }

  async getOrFetch(key) {
    try {
      // Tentar obter do cache
      const cached = await this.redis.get(key);

      if (cached) {
        return {
          data: JSON.parse(cached),
          cache: "HIT",
          headers: { "X-Cache": "HIT" },
        };
      }

      // Cache MISS - buscar da fonte
      const freshData = await this.fetcher();
      const payload = {
        ...freshData,
        captured_at: new Date().toISOString(),
        cache: "MISS",
      };

      // Salvar no cache com TTL
      await this.redis.set(key, JSON.stringify(payload), "EX", this.ttl); // 5 min TTL

      return {
        data: payload,
        cache: "MISS",
        headers: { "X-Cache": "MISS" },
      };
    } catch (error) {
      throw new Error("upstream_unavailable");
    }
  }
}

module.exports = { CacheService };
