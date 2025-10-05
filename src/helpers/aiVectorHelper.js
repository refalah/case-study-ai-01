const fs = require("fs");
const { pdf } = require("pdf-parse");
const { chroma } = require("../services/chromaService");

let collection;

const parsePDF = async (filePath) => {
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
};

const ingestKnowledgeBase = async () => {
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
};

const getRelevantDocs = async (query) => {
  try {
    const results = await collection.query({
      queryTexts: [query],
      nResults: 3,
    });
    return results.documents[0].join("\n");
  } catch (error) {
    console.error("❌ Failed to retrieve documents:", error.message);
    throw error;
  }
};

const initKnowledgeBase = async () => {
  try {
    collection = await chroma.getOrCreateCollection({
      name: "knowledge_base",
    });
    const count = await collection.count();
    if (count === 0) {
      await ingestKnowledgeBase();
    } else {
      console.log("✅ Knowledge base already loaded");
    }
  } catch (error) {
    console.error("❌ Failed to initialize Chroma:", error);
  }
};

module.exports = {
  parsePDF,
  ingestKnowledgeBase,
  getRelevantDocs,
  initKnowledgeBase,
};
