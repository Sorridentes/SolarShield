const { Classify } = require("./classify");

class CacheService {
  constructor(redis, fetcher, ttlSeconds = 300) {
    this.redis = redis;
    this.fetcher = fetcher;
    this.ttl = ttlSeconds;
  }

  async get(key) {
    try {
      // Tentar obter do cache
      const cached = await this.redis.get(key);

      return {
        data: JSON.parse(cached),
        cache: "HIT",
        headers: { "X-Cache": "HIT" },
      };
    } catch (error) {
      throw error;
    }
  }

  async getOrFetch(key) {
    try {
      // Tentar obter do cache
      const cached = await this.get(key);

      if (cached.data) {
        return cached;
      }
      const classify = new Classify();

      return await this.fetch(key, classify);
    } catch (error) {
      throw new Error("upstream_unavailable: " + error.message);
    }
  }

  async fetch(key, classify) {
    try {
      // Cache MISS - buscar da fonte
      const freshData = await this.fetcher();

      const latestEvent = freshData[freshData.length - 1];
      const kp = classify.extractMaxKp(latestEvent);
      const classification = classify.classifyKp(kp);

      const payload = {
        kp_index: kp,
        classification: classification.level,
        emergency_notification: classification.emergency_notification,
        captured_at: new Date().toISOString(),
        source: "NASA DONKI",
      };

      // Salvar no cache com TTL
      await this.redis.set(key, JSON.stringify(payload), "EX", this.ttl); // 5 min TTL

      return {
        data: payload,
        cache: "MISS",
        headers: { "X-Cache": "MISS" },
      };
    } catch (error) {
      throw error;
    }
  }
}

module.exports = { CacheService };
