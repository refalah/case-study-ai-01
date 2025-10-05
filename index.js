const express = require("express");
const fs = require("fs");
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");
const { pdf } = require("pdf-parse");
const cors = require("cors");
const Groq = require("groq-sdk");
const { ChromaClient } = require("chromadb");
const rateLimit = require("express-rate-limit");
const Joi = require('joi');
require("dotenv").config();

const app = express();
const PORT = 3000;


app.use(cors());
app.use(express.json());

// Rate limiting
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 uploads per window
  message: { error: "Too many uploads, please try again later" }
});

const evaluateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: "Too many evaluation requests, please try again later" }
});

// In-memory storage
const fileStorage = {};
const jobStorage = {};

const upload = multer({
  dest: "uploads/",
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "application/pdf") {
      cb(null, true);
    } else {
      cb(new Error("Only PDF files are allowed"));
    }
  }
});


////Validation Schemas ////
const evaluateSchema = Joi.object({
  job_title: Joi.string().min(3).max(100).required(),
  cv_id: Joi.string().uuid().required(),
  project_report_id: Joi.string().uuid().required()
});

const resultSchema = Joi.object({
  id: Joi.string().uuid().required()
});


//// LLM & Vector DB Setup ////
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const chroma = new ChromaClient();
let collection;

async function parsePDF(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    const dataBuffer = fs.readFileSync(filePath);
    const data = await pdf(dataBuffer);
    
    return data.text;
  } catch (err) {
    console.error("Error parsing PDF:", err);
    throw new Error(`PDF parsing failed: ${err.message}`);
  }
}

(async () => {
  try {
    collection = await chroma.getOrCreateCollection({ name: "knowledge_base" });

    const count = await collection.count();
    if (count === 0) {
      await ingestKnowledgeBase();
    } else {
      console.log("✅ Knowledge base already loaded");
    }
  } catch (error) {
    console.error("❌ Failed to initialize Chroma:", error);
  }
})();

async function ingestKnowledgeBase() {
  try {
    const jdText = await parsePDF("./docs/job_description.pdf");
    const briefText = await parsePDF("./docs/case_study_brief.pdf");
    const rubricText = await parsePDF("./docs/scoring_rubric.pdf");

    await collection.add({
      ids: ["job_description", "case_study", "scoring_rubric"],
      documents: [jdText, briefText, rubricText],
      metadatas: [
        { type: "job_description" },
        { type: "case_study" },
        { type: "scoring_rubric" },
      ],
    });

    console.log("✅ Knowledge base ingested into Chroma");
  } catch (error) {
    console.error("❌ Failed to ingest knowledge base:", error.message);
    throw error;
  }
}

async function getRelevantDocs(query) {
  const results = await collection.query({
    queryTexts: [query],
    nResults: 3,
  });
  return results.documents[0].join("\n");
}

// ------------------- ROUTES -------------------

app.post(
  "/upload",
  uploadLimiter,
  upload.fields([
    { name: "cv", maxCount: 1 },
    { name: "project", maxCount: 1 },
  ]),
  async (req, res, next) => {
    try {
      if (!req.files || !req.files.cv || !req.files.project) {
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
    } catch (error) {
      console.error(error);
      next(error);
    }
  }
);

app.post("/evaluate", evaluateLimiter, async (req, res, next) => {
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
      const projectRefs = await getRelevantDocs("case study evaluation rubric");

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

      const projectResult = JSON.parse(projectEval.choices[0].message.content);

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
});

app.get("/result/:id", (req, res, next) => {
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
});

// Global error handler
app.use((err, req, res, next) => { 
  console.error("Error:", err);
  if (err instanceof multer.MulterError) {
    const message = err.code === "LIMIT_FILE_SIZE" 
      ? "File too large. Maximum size is 10MB"  
      : `Upload error: ${err.message}`;
    return res.status(400).json({ error: message });
  }

  const statusCode = err.status || 500;
  
  res.status(statusCode).json({ error: err.message || "Internal server error"});
});


app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});