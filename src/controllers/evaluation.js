const express = require("express");
const router = express.Router();
const { v4: uuidv4 } = require("uuid");
const {
  uploadLimiter,
  evaluateLimiter,
} = require("../helpers/rateLimitHelper");
const { evaluateSchema, resultSchema } = require("../helpers/validationHelper");

const { uploadFields } = require("../helpers/uploadHelper");
const { evaluationQueue } = require("../services/redisService");
const { setFile, getFile, setJob, getJob } = require("../helpers/redisHelper");

const uploadFile = async (req, res, next) => {
  try {
    if (!req.files?.cv || !req.files?.project) {
      return res
        .status(400)
        .json({ error: "Both CV and project files are required" });
    }

    const cvId = uuidv4();
    const projectId = uuidv4();

    await setFile(cvId, {
      id: cvId,
      filename: req.files.cv[0].originalname,
      path: req.files.cv[0].path,
      uploadedAt: new Date().toISOString(),
    });

    await setFile(projectId, {
      id: projectId,
      filename: req.files.project[0].originalname,
      path: req.files.project[0].path,
      uploadedAt: new Date().toISOString(),
    });

    res.json({
      cv: { id: cvId, filename: req.files.cv[0].originalname },
      project: { id: projectId, filename: req.files.project[0].originalname },
    });
  } catch (err) {
    next(err);
  }
};

const evaluateUser = async (req, res, next) => {
  try {
    const { job_title, cv_id, project_report_id } = req.body;

    if (evaluateSchema.validate(req.body).error) {
      return res.status(400).json({ error: "Invalid request parameters" });
    }

    const cvFile = await getFile(cv_id);
    const projectFile = await getFile(project_report_id);

    if (!cvFile || !projectFile) {
      return res.status(404).json({ error: "File not found" });
    }

    const jobId = uuidv4();

    // Initialize job status in Redis
    await setJob(jobId, {
      id: jobId,
      status: "queued",
      createdAt: new Date().toISOString(),
    });

    await evaluationQueue.add("evaluationQueue", {
      jobId,
      job_title,
      cvFile,
      projectFile,
    });

    const job = await getJob(jobId);

    res.json(job);
  } catch (error) {
    next(error);
  }
};

const resultEval = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (resultSchema.validate(req.params).error) {
      return res.status(400).json({ error: "Invalid job ID format" });
    }

    const job = await getJob(id);

    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }

    res.json(job);
  } catch (error) {
    next(error);
  }
};

router.post("/upload", uploadLimiter, uploadFields, uploadFile);
router.post("/evaluate", evaluateLimiter, evaluateUser);
router.get("/result/:id", resultEval);

module.exports = router;
