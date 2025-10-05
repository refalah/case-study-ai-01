const express = require("express");
const router = express.Router();
const { v4: uuidv4 } = require("uuid");
const {
  uploadLimiter,
  evaluateLimiter,
} = require("../helpers/rateLimitHelper");
const { evaluateSchema, resultSchema } = require("../helpers/validationHelper");
const { parsePDF, getRelevantDocs } = require("../helpers/aiVectorHelper");
const { groq } = require("../services/chromaService");
const {uploadFields} = require("../helpers/uploadHelper");

const fileStorage = {};
const jobStorage = {};

const uploadFile = (req, res, next) => {
  try {
    if (!req.files?.cv || !req.files?.project) {
      return res
        .status(400)
        .json({ error: "Both CV and project files are required" });
    }

    const cvId = uuidv4();
    const projectId = uuidv4();

    fileStorage[cvId] = {
      id: cvId,
      filename: req.files.cv[0].originalname,
      path: req.files.cv[0].path,
      uploadedAt: new Date(),
    };

    fileStorage[projectId] = {
      id: projectId,
      filename: req.files.project[0].originalname,
      path: req.files.project[0].path,
      uploadedAt: new Date(),
    };

    res.json({
      cv: { id: cvId, filename: req.files.cv[0].originalname },
      project: { id: projectId, filename: req.files.project[0].originalname },
    });
  } catch (err) {
    next(err);
  }
};

const evaluateUser = (req, res, next) => {
  try {
    const { job_title, cv_id, project_report_id } = req.body;

    if (evaluateSchema.validate(req.body).error) {
      return res.status(400).json({ error: "Invalid request parameters" });
    }

    if (!fileStorage[cv_id] || !fileStorage[project_report_id]) {
      return res.status(404).json({ error: "File not found" });
    }

    const jobId = uuidv4();
    jobStorage[jobId] = {
      id: jobId,
      status: "processing",
      createdAt: new Date(),
    };

    res.json({ id: jobId, status: "processing" });

    (async () => {
      try {
        const cvText = await parsePDF(fileStorage[cv_id].path);
        const projectText = await parsePDF(fileStorage[project_report_id].path);

        const cvRefs = await getRelevantDocs(
          "backend developer job requirements CV scoring"
        );
        const projectRefs = await getRelevantDocs(
          "case study evaluation rubric"
        );

        // Evaluate CV with Groq
        const cvEval = await groq.chat.completions.create({
          model: "openai/gpt-oss-20b",
          messages: [
            {
              role: "system",
              content: `You are a technical recruiter scoring CVs. 
                Respond only with JSON using this format:
                    {"cv_match_rate": number(0-1),"cv_feedback": "One sentence summary of the overall sentiment"}`,
            },
            {
              role: "user",
              content: `Job Title: ${job_title}\n\nCandidate CV:\n${cvText}\n\nReference Documents:\n${cvRefs}`,
            },
          ],
          temperature: 0.3,
          response_format: { type: "json_object" },
        });

        console.log("CV Eval Response:", cvEval.choices[0]);
        const cvResult = JSON.parse(cvEval.choices[0].message.content);

        // Evaluate Project
        const projectEval = await groq.chat.completions.create({
          model: "openai/gpt-oss-20b",
          messages: [
            {
              role: "system",
              content: `You are a senior backend engineer. You are evaluating a candidate's project report based on a provided rubric. 
                Respond only with JSON using this format:
                    {"project_score": number(1-5),"project_feedback": "One sentence summary of the overall sentiment"}`,
            },
            {
              role: "user",
              content: `Project Report:\n${projectText}\n\nReference:\n${projectRefs}`,
            },
          ],
          temperature: 0.3,
          response_format: { type: "json_object" },
        });

        const projectResult = JSON.parse(
          projectEval.choices[0].message.content
        );

        // Summary

        const summary = await groq.chat.completions.create({
          model: "openai/gpt-oss-20b",
          messages: [
            {
              role: "system",
              content: `You are a hiring manager. 
          Your task is to analyze the provided CV and project information. 
          Respond only with JSON using this format:
          {
            "overall_summary": "3–5 sentence summary of the candidate's fit for the role",
            "is_accepted": boolean // true if the candidate is a good fit, false otherwise
          }`,
            },
            {
              role: "user",
              content: `CV: ${JSON.stringify(
                cvResult
              )}\nProject: ${JSON.stringify(projectResult)}`,
            },
          ],
          temperature: 0.5,
          response_format: { type: "json_object" },
        });

        const summaryResult = JSON.parse(summary.choices[0].message.content);

        jobStorage[jobId].status = "completed";
        jobStorage[jobId].result = {
          ...cvResult,
          ...projectResult,
          ...summaryResult,
        };
      } catch (err) {
        console.error("❌ Evaluation failed:", err);
        jobStorage[jobId].status = "failed";
        jobStorage[jobId].error = err.message || "Evaluation failed";
      }
    })();
  } catch (error) {
    next(error);
  }
};

const resultEval = (req, res, next) => {
  try {
    const { id } = req.params;
    if (resultSchema.validate(req.params).error) {
      return res.status(400).json({ error: "Invalid job ID format" });
    }
    const job = jobStorage[id];

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
