const multer = require("multer");

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
  },
});

const uploadFields = upload.fields([
  { name: "cv", maxCount: 1 },
  { name: "project", maxCount: 1 },
]);

module.exports = { uploadFields };
