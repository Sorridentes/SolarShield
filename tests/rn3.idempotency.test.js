const { NotifierService } = require("../src/notifier-service/notifier");
const { IdempotencyHandler } = require("../src/notifier-service/idempotency");

// Mocks
class RedisMock {
  constructor() {
    this.store = new Map();
  }

  async set(key, value, mode, ttl, condition) {
    if (condition === "NX" && this.store.has(key)) {
      return null;
    }
    this.store.set(key, value);
    if (ttl) {
      setTimeout(() => this.store.delete(key), ttl * 1000);
    }
    return "OK";
  }

  async get(key) {
    return this.store.get(key) || null;
  }

  async del(key) {
    return this.store.delete(key);
  }

  exists(key) {
    return this.store.has(key);
  }
}

class ChannelMock {
  constructor() {
    this.acknowledged = [];
    this.nacked = [];
  }

  async ack(msg) {
    this.acknowledged.push(msg);
  }

  async nack(msg, requeue = false) {
    this.nacked.push({ msg, requeue });
  }
}

describe("RN3 - Idempotência com Redis + RabbitMQ", () => {
  let redisMock;
  let notifierService;
  let idempotencyHandler;
  let channelMock;
  let loggerSpy;

  beforeEach(() => {
    redisMock = new RedisMock();
    channelMock = new ChannelMock();
    loggerSpy = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      log: jest.fn(),
    };

    idempotencyHandler = new IdempotencyHandler(redisMock, loggerSpy);
    notifierService = new NotifierService({
      redis: redisMock,
      channel: channelMock,
      logger: loggerSpy,
      idempotencyHandler: idempotencyHandler,
    });
  });

  describe("Processamento de mensagens do RabbitMQ", () => {
    test("deve processar evento novo e fazer ack", async () => {
      const msg = {
        content: Buffer.from(
          JSON.stringify({
            event_id: "evt-abc-001",
            kp_index: 8,
            classification: "severe",
            emergency_notification: true,
            neo_hazardous_count: 2,
            captured_at: "2026-06-09T18:42:00Z",
          }),
        ),
        properties: {
          headers: { "x-event-id": "evt-abc-001" },
          messageId: "evt-abc-001",
        },
      };

      await notifierService.handleMessage(msg);

      expect(loggerSpy.info).toHaveBeenCalledWith(
        expect.stringContaining("Processing event evt-abc-001"),
      );
      expect(channelMock.acknowledged).toContain(msg);
      expect(channelMock.nacked).toHaveLength(0);
    });

    test("deve descartar mensagem duplicada e fazer ack sem processar", async () => {
      const eventId = "evt-duplicate-001";
      const msg = {
        content: Buffer.from(
          JSON.stringify({
            event_id: eventId,
            kp_index: 6,
            classification: "moderate",
          }),
        ),
        properties: {
          headers: { "x-event-id": eventId },
          messageId: eventId,
        },
      };

      // Primeira mensagem
      await notifierService.handleMessage(msg);

      // Limpar logs para teste específico
      loggerSpy.warn.mockClear();

      // Segunda mensagem (duplicada)
      await notifierService.handleMessage(msg);

      expect(loggerSpy.warn).toHaveBeenCalledWith(
        expect.stringContaining(`Event ${eventId} already processed`),
        expect.any(Object),
      );
      expect(channelMock.acknowledged).toHaveLength(2); // Ambas as mensagens dão ack
    });
  });

  describe("Redis SET NX EX para idempotência", () => {
    test("deve usar operação atômica SET NX EX 86400", async () => {
      const setSpy = jest.spyOn(redisMock, "set");
      const eventId = "evt-atomic-001";

      const isFirst = await idempotencyHandler.checkAndMark(eventId);

      expect(setSpy).toHaveBeenCalledWith(
        `idem:notifier:${eventId}`,
        "processed",
        "EX",
        86400,
        "NX",
      );
      expect(isFirst).toBe(true);
    });

    test("deve retornar false para evento já processado", async () => {
      const eventId = "evt-processed-001";

      // Primeira marcação
      await idempotencyHandler.checkAndMark(eventId);

      // Segunda tentativa
      const isFirst = await idempotencyHandler.checkAndMark(eventId);

      expect(isFirst).toBe(false);
    });

    test("deve permitir reprocessamento após 24 horas", async () => {
      const eventId = "evt-ttl-001";

      // Marcar como processado
      await idempotencyHandler.checkAndMark(eventId);

      // Simular passagem de 24 horas (remover chave manualmente)
      await redisMock.del(`idem:notifier:${eventId}`);

      // Deve permitir processar novamente
      const isFirst = await idempotencyHandler.checkAndMark(eventId);

      expect(isFirst).toBe(true);
    });
  });

  describe("Tratamento de erros e retry", () => {
    test("deve fazer nack sem requeue se processamento falhar", async () => {
      const eventId = "evt-fail-001";
      const msg = {
        content: Buffer.from(
          JSON.stringify({
            event_id: eventId,
            kp_index: 8,
            classification: "severe",
          }),
        ),
        properties: {
          headers: { "x-event-id": eventId },
        },
      };

      // Simular falha no processamento
      jest
        .spyOn(notifierService, "processAlert")
        .mockRejectedValue(new Error("Notification failed"));

      await notifierService.handleMessage(msg);

      expect(channelMock.nacked).toHaveLength(1);
      expect(channelMock.nacked[0].requeue).toBe(false);
      expect(loggerSpy.error).toHaveBeenCalled();
    });

    test("deve deletar chave do Redis se processamento falhar", async () => {
      const eventId = "evt-fail-cleanup-001";
      const msg = {
        content: Buffer.from(JSON.stringify({ event_id: eventId })),
        properties: { headers: { "x-event-id": eventId } },
      };

      // Simular falha
      jest
        .spyOn(notifierService, "processAlert")
        .mockRejectedValue(new Error("Processing error"));

      await notifierService.handleMessage(msg);

      // Verificar se chave foi removida para permitir retry
      const key = `idem:notifier:${eventId}`;
      expect(redisMock.exists(key)).toBe(false);
    });

    test("deve manter chave no Redis se processamento for bem-sucedido", async () => {
      const eventId = "evt-success-001";
      const msg = {
        content: Buffer.from(JSON.stringify({ event_id: eventId })),
        properties: { headers: { "x-event-id": eventId } },
      };

      await notifierService.handleMessage(msg);

      const key = `idem:notifier:${eventId}`;
      expect(redisMock.exists(key)).toBe(true);
    });
  });

  describe("Logging detalhado", () => {
    test("deve logar quando evento duplicado é detectado", async () => {
      const eventId = "evt-log-001";
      const msg = {
        content: Buffer.from(JSON.stringify({ event_id: eventId })),
        properties: { headers: { "x-event-id": eventId } },
      };

      await notifierService.handleMessage(msg);
      await notifierService.handleMessage(msg);

      expect(loggerSpy.warn).toHaveBeenCalledWith(
        `[DUPLICATE] Event ${eventId} already processed. Skipping.`,
        expect.any(Object),
      );
    });

    test("deve logar quando novo evento é processado", async () => {
      const eventId = "evt-new-001";
      const msg = {
        content: Buffer.from(
          JSON.stringify({
            event_id: eventId,
            classification: "severe",
          }),
        ),
        properties: { headers: { "x-event-id": eventId } },
      };

      await notifierService.handleMessage(msg);

      expect(loggerSpy.info).toHaveBeenCalledWith(
        expect.stringContaining(`[NEW ALERT] Processing event ${eventId}`),
      );
    });

    test("deve logar alertas de emergência", async () => {
      const eventId = "evt-emergency-001";
      const msg = {
        content: Buffer.from(
          JSON.stringify({
            event_id: eventId,
            emergency_notification: true,
            classification: "severe",
          }),
        ),
        properties: { headers: { "x-event-id": eventId } },
      };

      await notifierService.handleMessage(msg);

      expect(loggerSpy.log).toHaveBeenCalledWith(
        expect.stringContaining(
          `!!! EMERGENCY NOTIFICATION SENT FOR EVENT ${eventId} !!!`,
        ),
      );
    });
  });
});
