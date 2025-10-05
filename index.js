const express = require("express");
const cors = require("cors");
const { initKnowledgeBase } = require("./src/helpers/aiVectorHelper");
const evalController = require("./src/controllers/evaluation");

require("dotenv").config();

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

(async () => {
  try {
    await initKnowledgeBase();
  } catch (err) {
    console.error("Failed to initialize knowledge base:", err);
  }
})();


// Global error handler
app.use((err, req, res, next) => {
  console.error("Error:", err);
  if (err.code === "LIMIT_FILE_SIZE") {
    return res
      .status(400)
      .json({ error: "File too large. Maximum size is 10MB" });
  } else if (err.message === "Only PDF files are allowed") {
    return res.status(400).json({ error: err.message });
  }

  const statusCode = err.status || 500;

  res
    .status(statusCode)
    .json({ error: err.message || "Internal server error" });
});

app.use("/", evalController);

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
