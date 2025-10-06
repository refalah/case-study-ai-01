const { Worker } = require("bullmq");
const {
  parsePDF,
  getRelevantDocs,
  initKnowledgeBase,
} = require("../helpers/aiVectorHelper");
const { groq } = require("../services/chromaService");
const { redisClient, evaluationQueue } = require("../services/redisService");
const { setJob } = require("../helpers/redisHelper");

let collection;
(async () => {
  try {
    collection = await initKnowledgeBase();
    console.log("✅ Knowledge base initialized from worker");

    const failedJobs = await evaluationQueue.getFailed();
    if (failedJobs.length === 0) {
      console.log("No failed jobs found.");
      return;
    } else {
      console.log(`Found ${failedJobs.length} failed jobs, retrying...`);
      let count = 0;
      for (const job of failedJobs) {
        count++;
        await job.retry(); // This resets attempts and retries the job

        if (count < failedJobs.length) {
          await new Promise((resolve) => setTimeout(resolve, 5000)); // 5-second delay
        }
      }
    }
  } catch (err) {
    console.error("❌ Failed to initialize knowledge base (worker):", err);
    process.exit(1); // Exit if initialization fails
  }
})();

// Worker will automatically pick jobs from the queue
const evaluationWorker = new Worker(
  "evaluationQueue",
  async (job) => {
    const { jobId, job_title, cvFile, projectFile } = job.data;
    console.log(`Processing job ${jobId}...`);
    // Update job status to processing
    await setJob(jobId, {
      id: jobId,
      status: "processing",
      createdAt: new Date().toISOString(),
    });
    const cvText = await parsePDF(cvFile.path);
    const projectText = await parsePDF(projectFile.path);

    const cvRefs = await getRelevantDocs(
      collection,
      "Fetch data related to CV evaluation for backend engineering job"
    );
    const projectRefs = await getRelevantDocs(
      collection,
      "Fetch data related to project evaluation and its case study"
    );

    // Evaluate CV
    const cvEval = await groq.chat.completions.create({
      model: "openai/gpt-oss-20b",
      messages: [
        {
          role: "system",
          content: `You are a technical recruiter scoring CVs. Use the Reference Documents to evaluate the candidate's CV. 
            Respond only with JSON using this format: {
                "cv_match_rate": number // determine the match rate on a scale of 0-1,
                "cv_feedback": "One sentence summary of the overall sentiment"}`,
        },
        {
          role: "user",
          content: `Job Title: ${job_title}\n\nCandidate CV:\n${cvText}\n\nReference Documents:\n${cvRefs}`,
        },
      ],
      temperature: 0.0,
      response_format: { type: "json_object" },
    });

    const cvResult = JSON.parse(cvEval.choices[0].message.content);

    // Evaluate Project
    const projectEval = await groq.chat.completions.create({
      model: "openai/gpt-oss-20b",
      messages: [
        {
          role: "system",
          content: `You are a senior engineer evaluating a project. Use the Reference Documents to evaluate the candidate's project.
          Respond with JSON: {
          "project_score": number // determine the score of the project on a scale of 1 to 5,
          "project_feedback": "One sentence summary of the overall sentiments"}`,
        },
        {
          role: "user",
          content: `Candidate Project:\n${projectText}\nReference Documents:\n${projectRefs}`,
        },
      ],
      temperature: 0.0,
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
      Your task is to analyze the provided CV and project information. Minimum passing grade is 0.5 for CV and 3 for Project. 
      Respond only with JSON using this format:
      {
        "overall_summary": "3 to 5 sentence summary of the candidate's fit for the role",
        "is_accepted": boolean // true if the candidate is a good fit, false otherwise
      }`,
        },
        {
          role: "user",
          content: `CV: ${JSON.stringify(cvResult)}\nProject: ${JSON.stringify(
            projectResult
          )}`,
        },
      ],
      temperature: 0.1,
      response_format: { type: "json_object" },
    });

    const summaryResult = JSON.parse(summary.choices[0].message.content);

    await setJob(jobId, {
      id: jobId,
      status: "completed",
      createdAt: new Date().toISOString(),
      result: { ...cvResult, ...projectResult, ...summaryResult },
    });
  },
  { connection: redisClient }
);

evaluationWorker.on("completed", (job, result) => {
  console.log(`✅ Job ${job.id} completed.`);
});

evaluationWorker.on("failed", async (job, err) => {
  console.error(`❌ Job ${job.id} failed:`, err.message);
  const jobId = job?.data?.jobId;
  // Update job status to failed in Redis
  if (jobId) {
    await setJob(jobId, {
      id: jobId,
      status: "failed",
      createdAt: new Date().toISOString(),
    });
  }
});

module.exports = { evaluationWorker };
