require("dotenv").config();
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
    // Parse with chunking
    const jdChunks = await parsePDF("./docs/job_description.pdf", { 
      returnChunks: true, 
      chunkSize: 800 
    });
    const briefChunks = await parsePDF("./docs/case_study_brief.pdf", { 
      returnChunks: true, 
      chunkSize: 800 
    });
    const rubricChunks = await parsePDF("./docs/scoring_rubric.pdf", { 
      returnChunks: true, 
      chunkSize: 800 
    });

    const ids = [];
    const documents = [];
    const metadatas = [];

    // Add JD chunks
    jdChunks.forEach((chunk, i) => {
      ids.push(`job_description_${i}`);
      documents.push(chunk);
      metadatas.push({ type: "job_description", chunk: i });
    });

    // Add brief chunks
    briefChunks.forEach((chunk, i) => {
      ids.push(`case_study_${i}`);
      documents.push(chunk);
      metadatas.push({ type: "case_study", chunk: i });
    });

    // Add rubric chunks
    rubricChunks.forEach((chunk, i) => {
      ids.push(`scoring_rubric_${i}`);
      documents.push(chunk);
      metadatas.push({ type: "scoring_rubric", chunk: i });
    });

    await collection.add({
      ids,
      documents,
      metadatas,
    });

    console.log(`✅ Knowledge base ingested: ${documents.length} chunks total`);
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
    console.log("Initializing knowledge base...");
    collection = await chroma.getOrCreateCollection({
      name: process.env.COLLECTION_NAME || "knowledge_base_00",
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
