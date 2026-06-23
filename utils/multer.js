const multer = require("multer");
const path = require("path");

// Configure storage engine
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'public/images'); // Ensure this directory exists
  },
  filename: function (req, file, cb) {
    const timestamp = Date.now();
    const random = Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname).toLowerCase();

    // Sanitize base name (remove slashes or weird chars)
    let baseName = path.parse(file.originalname).name.replace(/[^\w\-]/g, '_');
    cb(null, `${baseName}-${timestamp}-${random}${ext}`);
  }
});

// File filter for image types only
const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (![".jpg", ".jpeg", ".png"].includes(ext)) {
    cb(new Error("Unsupported file type! Only .jpg, .jpeg, .png allowed."), false);
  } else {
    cb(null, true);
  }
};

// Create and export configured multer instance
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

module.exports = upload;