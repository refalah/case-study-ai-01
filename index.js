const express = require("express");
const fs = require("fs");
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");
const pdfParse = require("pdf-parse");

const cors = require("cors");
const Groq = require("groq-sdk");

const { ChromaClient } = require("chromadb");

require("dotenv").config();

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

// In-memory storage
const fileStorage = {};
const jobStorage = {};

// Multer setup
const upload = multer({ dest: "uploads/" });

// Groq client (FREE!)
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Chroma client
const chroma = new ChromaClient();
let collection;

// ✅ PDF Parser
async function parsePDF(filePath) {
   try {
    const dataBuffer = fs.readFileSync(filePath);
    const data = await pdfParse(dataBuffer);
    return data.text; // extracted text
  } catch (err) {
    console.error("Error parsing PDF:", err);
    throw err;
  }
}

// Initialize Chroma collection
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
        { type: "scoring_rubric" }
      ]
    });

    console.log("✅ Knowledge base ingested into Chroma");
  } catch (error) {
    console.error("❌ Failed to ingest knowledge base:", error.message);
  }
}

async function getRelevantDocs(query) {
  const results = await collection.query({
    queryTexts: [query],
    nResults: 3
  });
  return results.documents[0].join("\n");
}

// ------------------- ROUTES -------------------

app.post(
  "/upload",
  upload.fields([
    { name: "cv", maxCount: 1 },
    { name: "project", maxCount: 1 }
  ]),
  async (req, res) => {
    try {
      if (!req.files || !req.files.cv || !req.files.project) {
        return res.status(400).json({ error: "Both CV and project files are required" });
      }

      const cvId = uuidv4();
      const projectId = uuidv4();

      fileStorage[cvId] = {
        id: cvId,
        filename: req.files.cv[0].originalname,
        path: req.files.cv[0].path,
        uploadedAt: new Date()
      };

      fileStorage[projectId] = {
        id: projectId,
        filename: req.files.project[0].originalname,
        path: req.files.project[0].path,
        uploadedAt: new Date()
      };

      res.json({
        cv: { id: cvId, filename: req.files.cv[0].originalname },
        project: { id: projectId, filename: req.files.project[0].originalname }
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Upload failed" });
    }
  }
);

app.post("/evaluate", async (req, res) => {
  const { job_title, cv_id, project_report_id } = req.body;

  if (!fileStorage[cv_id] || !fileStorage[project_report_id]) {
    return res.status(404).json({ error: "File not found" });
  }

  const jobId = uuidv4();
  jobStorage[jobId] = {
    id: jobId,
    status: "processing",
    createdAt: new Date()
  };

  res.json({ id: jobId, status: "processing" });

  (async () => {
    try {
      const cvText = await parsePDF(fileStorage[cv_id].path);
      const projectText = await parsePDF(fileStorage[project_report_id].path);

      const cvRefs = await getRelevantDocs("backend developer job requirements CV scoring");
      const projectRefs = await getRelevantDocs("case study evaluation rubric");

      // Evaluate CV with Groq
      const cvEval = await groq.chat.completions.create({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: "You are a technical recruiter scoring CVs. Return only valid JSON." },
          {
            role: "user",
            content: `Job Title: ${job_title}\n\nCandidate CV:\n${cvText}\n\nReference Documents:\n${cvRefs}\n\nReturn JSON with { "cv_match_rate": number(0-1), "cv_feedback": string }`
          }
        ],
        temperature: 0.3,
      });

      const cvResult = JSON.parse(cvEval.choices[0].message.content);

      // Evaluate Project
      const projectEval = await groq.chat.completions.create({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: "You are a senior backend engineer. Return only valid JSON." },
          {
            role: "user",
            content: `Project Report:\n${projectText}\n\nReference:\n${projectRefs}\n\nReturn JSON with { "project_score": number(1-5), "project_feedback": string }`
          }
        ],
        temperature: 0.3,
      });

      const projectResult = JSON.parse(projectEval.choices[0].message.content);

      // Summary
      const summary = await groq.chat.completions.create({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: "You are a hiring manager." },
          {
            role: "user",
            content: `CV: ${JSON.stringify(cvResult)}\nProject: ${JSON.stringify(projectResult)}\n\nProvide 3-5 sentence summary.`
          }
        ],
        temperature: 0.5,
      });

      jobStorage[jobId].status = "completed";
      jobStorage[jobId].result = {
        ...cvResult,
        ...projectResult,
        overall_summary: summary.choices[0].message.content
      };

    } catch (err) {
      console.error("❌ Evaluation failed:", err);
      jobStorage[jobId].status = "failed";
      jobStorage[jobId].error = err.message || "Evaluation failed";
    }
  })();
});

app.get("/result/:id", (req, res) => {
  const { id } = req.params;
  const job = jobStorage[id];

  if (!job) {
    return res.status(404).json({ error: "Job not found" });
  }

  res.json(job);
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});