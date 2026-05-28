const express = require("express");
const Redis = require("ioredis");
const amqp = require("amqplib");
require("dotenv").config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const RABBITMQ_URL = process.env.RABBITMQ_URL || "amqp://localhost";
const NASA_API_KEY = process.env.NASA_API_KEY || "DEMO_KEY";

const redis = new Redis(REDIS_URL);

async function getRabbitChannel() {
  const connection = await amqp.connect(RABBITMQ_URL);
  const channel = await connection.createChannel();
  await channel.assertExchange("space.events", "topic", { durable: true });
  return channel;
}

const { Classify } = require("./classify");
const { NasaClientWithRetry } = require("./nasa_client");
const { CacheService } = require("./cache");

app.get("/api/space-weather/current", async (req, res) => {
  try {
    const cached = await redis.get("space-weather:current");
    if (cached) {
      return res.json({ ...JSON.parse(cached), cache: "HIT" });
    }

    const nasaClient = new NasaClientWithRetry({
      baseURL: "https://api.nasa.gov",
      timeout: 500,
      apiKey: "DEMO_KEY",
    });
    const classify = new Classify();

    const data = await nasaClient.fetchKpWindow();

    // Simulação de lógica para pegar o mais recente ou processar
    const kp = classify.extractMaxKp(data);
    const classification = classify.classifyKp(kp);

    const result = {
      kp_index: kp,
      classification: classification.level,
      emergency_notification: classification.emergency,
      captured_at: new Date().toISOString(),
      source: "NASA DONKI",
    };

    const cacheService = new CacheService(redis, async () => {
      redis, result, 300;
    });

    result = await cacheService.getOrFetch("space-weather:current");

    await redis.set("space-weather:current", JSON.stringify(result), "EX", 300); // 5 min TTL
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/space-weather/ingest", async (req, res) => {
  try {
    const { startDate, endDate } = req.body;

    const data = await nasaClient.fetchKpWindow(startDate, endDate);
    const channel = await getRabbitChannel();

    for (const event of data) {
      const kp = classify.extractMaxKp(event);
      const classification = classify.classifyKp(kp);

      const message = {
        event_id: event.gstID,
        kp_index: kp,
        classification: classification.level,
        emergency_notification: classification.emergency,
        captured_at: new Date().toISOString(),
        occurred_at: event.startTime,
      };

      channel.publish(
        "space.events",
        "space.weather.alert",
        Buffer.from(JSON.stringify(message)),
        {
          headers: { "x-event-id": event.gstID },
        }
      );
    }

    res.status(202).json({ status: "queued", count: data.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/neo/feed", async (req, res) => {
  const date = req.query.date || new Date().toISOString().split("T")[0];
  const nasaClient = new NasaClientWithRetry({
    baseURL: "https://api.nasa.gov",
    timeout: 500,
    apiKey: "DEMO_KEY",
  });
  try {
    const data = await nasaClient.fetchKpWindow(
      (startDate = data),
      (endDate = data),
      (endpoint = `neo/rest/v1/feed`)
    );
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => console.log(`Ingestor service running on port ${PORT}`));
