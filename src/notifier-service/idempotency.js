class IdempotencyHandler {
  constructor(redis, logger) {
    this.redis = redis;
    this.logger = logger;
  }

  async checkAndMark(eventId) {
    const key = `idem:notifier:${eventId}`;
    // Operação atômica: SET se não existir, com TTL de 24 horas
    const result = await this.redis.set(key, "processed", "EX", 86400, "NX");
    return result === "OK";
  }

  extractEventId(msg) {
    // Prioridade: header x-event-id > messageId > body.event_id
    const headerId = msg.properties?.headers?.["x-event-id"];
    if (headerId) return headerId;

    const messageId = msg.properties?.messageId;
    if (messageId) return messageId;

    try {
      const content = JSON.parse(msg.content.toString());
      return content.event_id;
    } catch (error) {
      throw new Error("Unable to extract event_id from message");
    }
  }

  async markForRetry(eventId) {
    const key = `idem:notifier:${eventId}`;
    await this.redis.del(key);
  }
}

module.exports = { IdempotencyHandler };
