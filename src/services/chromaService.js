require("dotenv").config();
const Groq = require("groq-sdk");
const { ChromaClient } = require("chromadb");

const chroma = new ChromaClient();
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

module.exports = { chroma, groq };