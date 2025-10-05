const {redisClient} = require("../services/redisService");
const { uploadFields } = require("../helpers/uploadHelper");

// Redis key prefixes
const FILE_PREFIX = "file:";
const JOB_PREFIX = "job:";
const FILE_TTL = 86400; // 24 hours
const JOB_TTL = 86400; // 24 hours

// Helper functions for Redis operations
const setFile = async (id, data) => {
  await redisClient.set(
    `${FILE_PREFIX}${id}`,
    JSON.stringify(data),
    'EX',
    FILE_TTL,
  );
};

const getFile = async (id) => {
  const data = await redisClient.get(`${FILE_PREFIX}${id}`);
  return data ? JSON.parse(data) : null;
};

const setJob = async (id, data) => {
   await redisClient.set(
    `${JOB_PREFIX}${id}`,
    JSON.stringify(data),
    'EX',
    JOB_TTL
  );
};

const getJob = async (id) => {
  const data = await redisClient.get(`${JOB_PREFIX}${id}`);
  return data ? JSON.parse(data) : null;
};

module.exports = { setFile, getFile, setJob, getJob, uploadFields };
