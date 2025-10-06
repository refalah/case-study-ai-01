const Redis = require("ioredis");
const { Queue } = require("bullmq");

const redisClient = new Redis({
  host: process.env.REDIS_HOST || "localhost",
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  db: process.env.REDIS_DB || 0,
  maxRetriesPerRequest: null,
});

redisClient.on("connect", () => {
  console.log("Connected to Redis server");
});

redisClient.on("error", (err) => {
  console.error("Redis Error:", err);
});

redisClient.on("close", () => {
  console.log("Redis connection closed");
});

const evaluationQueue = new Queue("evaluationQueue", {
  connection: redisClient,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: true,
    removeOnFail: { age: 7 * 24 * 3600 }, // 7 days
  },
});

module.exports = { redisClient, evaluationQueue };
