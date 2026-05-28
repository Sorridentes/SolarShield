const express = require("express");
const Redis = require("ioredis");
const amqp = require("amqplib");
require("dotenv").config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT;
const REDIS_URL = process.env.REDIS_URL;
const RABBITMQ_URL = process.env.RABBITMQ_URL;
const NASA_API_KEY = process.env.NASA_API_KEY;

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
    const nasaClient = new NasaClientWithRetry({
      baseURL: "https://api.nasa.gov",
      timeout: 500,
      apiKey: NASA_API_KEY,
    });
    const classify = new Classify();
    const cacheService = new CacheService(
      redis,
      async () => {
        const result = await nasaClient.fetchKpWindow();
        return result;
      },
      300, // TTL 5 minutos
    );

    const cache = await cacheService.get("space-weather:current");

    if (cache.data) {
      return res.json(cache);
    }

    result = await cacheService.fetch("space-weather:current", classify);

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/space-weather/ingest", async (req, res) => {
  try {
    const { startDate, endDate } = req.body;

    const nasaClient = new NasaClientWithRetry({
      baseURL: "https://api.nasa.gov",
      timeout: 500,
      apiKey: NASA_API_KEY,
    });
    const classify = new Classify();

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
        },
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
    apiKey: NASA_API_KEY,
  });
  try {
    const data = await nasaClient.fetchKpWindow(
      (startDate = data),
      (endDate = data),
      (endpoint = `neo/rest/v1/feed`),
    );
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "ingestor",
    timestamp: new Date().toISOString(),
  });
});

app.listen(PORT, () => console.log(`Ingestor service running on port ${PORT}`));
