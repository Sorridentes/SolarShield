const amqp = require("amqplib");
const Redis = require("ioredis");
const logger = require("../core/logging");
require("dotenv").config();

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const RABBITMQ_URL = process.env.RABBITMQ_URL || "amqp://localhost";

const redis = new Redis(REDIS_URL);

async function start() {
  const connection = await amqp.connect(RABBITMQ_URL);
  const channel = await connection.createChannel();

  const notifierService = new NotifierService({
    redis,
    channel,
    logger: logger,
  });

  await notifierService.setupRabbitMQ();
}

start();
