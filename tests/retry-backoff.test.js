const { NasaClientWithRetry } = require("../src/ingestor-service/nasa_client");
const axios = require("axios");
jest.mock("axios");

describe("Retry com Backoff Exponencial - Chamadas à NASA", () => {
  let nasaClient;

  beforeEach(() => {
    jest.clearAllMocks();
    nasaClient = new NasaClientWithRetry({
      baseURL: "https://api.nasa.gov",
      timeout: 500,
      apiKey: "DEMO_KEY",
    });
  });

  describe("Política de retry", () => {
    test("deve retry até 4 vezes para erro 500", async () => {
      const mockGet = jest.spyOn(axios, "get");
      const err = new Error("Internal Server Error");
      err.response = { status: 500 };
      mockGet.mockRejectedValue(err);

      await expect(
        nasaClient.fetchKpWindow("2024-01-01", "2024-01-02"),
      ).rejects.toThrow();

      expect(mockGet).toHaveBeenCalledTimes(4); // 1 original + 3 retries
    });

    test("deve retry até 4 vezes para erro 429 (rate limit)", async () => {
      const mockGet = jest.spyOn(axios, "get");
      const err = Error("Too Many Requests");
      err.response = { status: 429 };
      mockGet.mockRejectedValue(err);

      await expect(
        nasaClient.fetchKpWindow("2024-01-01", "2024-01-02"),
      ).rejects.toThrow();

      expect(mockGet).toHaveBeenCalledTimes(4);
    });

    test("NÃO deve retry para erro 400 (Bad Request)", async () => {
      const mockGet = jest.spyOn(axios, "get");
      const err = Error("Bad Request");
      err.response = { status: 400 };
      mockGet.mockRejectedValue(err);

      await expect(
        nasaClient.fetchKpWindow("2024-01-01", "2024-01-02"),
      ).rejects.toThrow();

      expect(mockGet).toHaveBeenCalledTimes(1); // Apenas chamada original
    });

    test("deve retry para timeout", async () => {
      const mockGet = jest.spyOn(axios, "get");
      const err = new Error("timeout of 500ms exceeded");
      err.code = "ECONNABORTED";
      mockGet.mockRejectedValue(err);

      await expect(
        nasaClient.fetchKpWindow("2024-01-01", "2024-01-02"),
      ).rejects.toThrow();

      expect(mockGet).toHaveBeenCalledTimes(4);
    });
  });

  describe("Backoff exponencial", () => {
    test("deve usar delays: 500ms, 1000ms, 2000ms", async () => {
      const mockGet = jest.spyOn(axios, "get");
      const err = Error();
      err.response = { status: 500 };
      mockGet.mockRejectedValue(err);

      const startTime = Date.now();

      await expect(
        nasaClient.fetchKpWindow("2024-01-01", "2024-01-02"),
      ).rejects.toThrow();

      const elapsed = Date.now() - startTime;
      // Mínimo esperado: 500 + 1000 + 2000 = 3500ms (última tentativa não conta delay)
      expect(elapsed).toBeGreaterThanOrEqual(3500);
    });
  });

  describe("Logging de tentativas", () => {
    test("deve logar cada tentativa com correlation id", async () => {
      const mockGet = jest.spyOn(axios, "get");
      const err = Error();
      err.response = { status: 500 };
      mockGet.mockRejectedValue(err);

      const loggerSpy = jest.spyOn(console, "log").mockImplementation();

      await expect(
        nasaClient.fetchKpWindow("2024-01-01", "2024-01-02"),
      ).rejects.toThrow();

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining("Tentativa 1/4"),
      );
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining("Tentativa 2/4"),
      );
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining("Tentativa 3/4"),
      );
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining("Tentativa 4/4"),
      );
    });
  });

  describe("Sucesso após retry", () => {
    test("deve retornar sucesso se 3ª tentativa funcionar", async () => {
      const mockGet = jest.spyOn(axios, "get");
      const err = Error();
      err.response = { status: 500 };

      // Falha nas duas primeiras, sucesso na terceira
      mockGet
        .mockRejectedValueOnce(err)
        .mockRejectedValueOnce(err)
        .mockResolvedValueOnce({
          data: [{ kpIndex: 6, gstID: "test-001" }],
        });

      const result = await nasaClient.fetchKpWindow("2024-01-01", "2024-01-02");

      expect(result).toBeDefined();
      expect(mockGet).toHaveBeenCalledTimes(3);
    });
  });
});
