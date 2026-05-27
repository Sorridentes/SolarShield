// notifier.js
class NotifierService {
  constructor({ redis, channel, logger, idempotencyHandler }) {
    this.redis = redis;
    this.channel = channel;
    this.logger = logger;
    this.idempotencyHandler =
      idempotencyHandler || new IdempotencyHandler(redis, logger);
    this.processedEvents = new Map(); // Para testes apenas
  }

  async setupRabbitMQ() {
    const exchange = "space.events";
    const queue = "notifier.alerts";

    await this.channel.assertExchange(exchange, "topic", { durable: true });
    await this.channel.assertQueue(queue, { durable: true });
    await this.channel.bindQueue(queue, exchange, "space.weather.alert");

    // Prefetch de 10 mensagens
    await this.channel.prefetch(10);

    this.logger.info(`Notifier service waiting for messages in ${queue}...`);

    // Consumir mensagens
    await this.channel.consume(queue, (msg) => this.handleMessage(msg));
  }

  async handleMessage(msg) {
    if (!msg) return;

    try {
      const eventId = this.idempotencyHandler.extractEventId(msg);
      const content = JSON.parse(msg.content.toString());

      // Verificar idempotência com Redis (operação atômica)
      const isFirst = await this.idempotencyHandler.checkAndMark(eventId);

      if (!isFirst) {
        this.logger.warn(
          `[DUPLICATE] Event ${eventId} already processed. Skipping.`,
          {
            eventId,
            messageId: msg.properties.messageId,
          }
        );
        await this.channel.ack(msg);
        return;
      }

      this.logger.info(`[NEW ALERT] Processing event ${eventId}: ${content}`);

      await this.processAlert(eventId, content);

      // Confirmar processamento
      await this.channel.ack(msg);
    } catch (error) {
      this.logger.error("Error processing message:", error);

      // Em caso de erro, remover marca de idempotência para permitir reprocessamento
      try {
        const eventId = this.idempotencyHandler.extractEventId(msg);
        await this.idempotencyHandler.markForRetry(eventId);
      } catch (extractError) {
        this.logger.error(
          "Failed to extract eventId for cleanup:",
          extractError
        );
      }

      // Não reencaminhar para evitar loop infinito (vai para DLQ se configurada)
      await this.channel.nack(msg, false, false);
    }
  }

  async processAlert(eventId, content) {
    if (content.emergency_notification) {
      this.logger.log(
        `!!! EMERGENCY NOTIFICATION SENT FOR EVENT ${eventId} !!!`
      );
    }
  }
}

module.exports = { NotifierService };
