// const { CacheService } = require("../src/ingestor-service/cache");

class RedisCacheMock {
  constructor() {
    this.cache = new Map();
    this.ttl = new Map();
  }

  async get(key) {
    if (this.cache.has(key)) {
      const expiresAt = this.ttl.get(key);
      if (expiresAt && Date.now() > expiresAt) {
        this.cache.delete(key);
        this.ttl.delete(key);
        return null;
      }
      return this.cache.get(key);
    }
    return null;
  }

  async set(key, value, mode, ttlSeconds) {
    this.cache.set(key, value);
    if (ttlSeconds) {
      this.ttl.set(key, Date.now() + ttlSeconds * 1000);
    }
    return "OK";
  }
}

describe("Cache Redis - Cache-Aside Pattern com TTL 5 minutos", () => {
  let cacheService;
  let redisMock;
  let nasaFetcherMock;

  beforeEach(() => {
    redisMock = new RedisCacheMock();
    nasaFetcherMock = jest.fn();
    cacheService = new CacheService(redisMock, nasaFetcherMock, 300); // TTL 5 minutos
  });

  describe("Cache HIT/MISS", () => {
    test("primeira chamada deve ser MISS e buscar da NASA", async () => {
      const nasaData = { kp_index: 6, classification: "moderate" };
      nasaFetcherMock.mockResolvedValue(nasaData);

      const result = await cacheService.getOrFetch("space:current:weather");

      expect(result.cache).toBe("MISS");
      expect(nasaFetcherMock).toHaveBeenCalledTimes(1);
    });

    test("segunda chamada dentro do TTL deve ser HIT", async () => {
      const nasaData = { kp_index: 6, classification: "moderate" };
      nasaFetcherMock.mockResolvedValue(nasaData);

      await cacheService.getOrFetch("space:current:weather");
      const result = await cacheService.getOrFetch("space:current:weather");

      expect(result.cache).toBe("HIT");
      expect(nasaFetcherMock).toHaveBeenCalledTimes(1); // Apenas uma chamada real
    });
  });

  describe("Headers de cache", () => {
    test("deve retornar header X-Cache: HIT quando acerta cache", async () => {
      const nasaData = { kp_index: 5, classification: "moderate" };
      nasaFetcherMock.mockResolvedValue(nasaData);

      // Primeira chamada (MISS)
      const result1 = await cacheService.getOrFetch("space:current:weather");
      expect(result1.headers["X-Cache"]).toBe("MISS");

      // Segunda chamada (HIT)
      const result2 = await cacheService.getOrFetch("space:current:weather");
      expect(result2.headers["X-Cache"]).toBe("HIT");
    });

    test("deve incluir timestamp no response", async () => {
      const nasaData = { kp_index: 5, classification: "moderate" };
      nasaFetcherMock.mockResolvedValue(nasaData);

      const result = await cacheService.getOrFetch("space:current:weather");

      expect(result.data.captured_at).toBeDefined();
      expect(new Date(result.data.captured_at)).toBeInstanceOf(Date);
    });
  });

  describe("Validação do TTL", () => {
    test("TTL deve ser exatamente 300 segundos (5 minutos)", () => {
      expect(cacheService.ttl).toBe(300);
    });

    test("deve salvar no Redis com EX = TTL", async () => {
      const setSpy = jest.spyOn(redisMock, "set");
      const nasaData = { kp_index: 7, classification: "moderate" };
      nasaFetcherMock.mockResolvedValue(nasaData);

      await cacheService.getOrFetch("space:current:weather");

      expect(setSpy).toHaveBeenCalledWith(
        "space:current:weather",
        expect.any(String),
        "EX",
        300,
      );
    });
  });

  describe("Tratamento de erros", () => {
    test("deve retornar erro quando NASA falha e cache vazio", async () => {
      nasaFetcherMock.mockRejectedValue(new Error("NASA API error"));

      await expect(
        cacheService.getOrFetch("space:current:weather"),
      ).rejects.toThrow("upstream_unavailable");
    });
  });
});
