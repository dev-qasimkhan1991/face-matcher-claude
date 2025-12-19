require("dotenv").config();

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const AWS = require("aws-sdk");
const {
  RekognitionClient,
  CreateFaceLivenessSessionCommand,
  GetFaceLivenessSessionResultsCommand,
} = require("@aws-sdk/client-rekognition");
const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const AWS_REGION = process.env.AWS_REGION || "us-east-1";

if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
  console.warn("Warning: AWS credentials not found in env.");
}

// Configure AWS SDK v2
AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: AWS_REGION,
});
const rekognitionV2 = new AWS.Rekognition();
const stsV2 = new AWS.STS({ region: AWS_REGION });

// Configure AWS SDK v3 for Liveness
const rekogV3 = new RekognitionClient({ region: AWS_REGION });

// Multer upload setup
const uploadsDir = path.resolve(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (req, file, cb) =>
    cb(null, Date.now() + path.extname(file.originalname)),
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const allowed = ["image/png", "image/jpg", "image/jpeg"];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error("Only JPG, JPEG, PNG allowed"));
    }
    cb(null, true);
  },
});

// ======================================================
// 1) COMPARE FACES (with URL from API)
// ======================================================
app.post("/compare", upload.single("image2"), async (req, res) => {
  try {
    const { aadhaarUrl } = req.body;
    if (!aadhaarUrl)
      return res.status(400).json({ error: "aadhaarUrl is required" });
    if (!req.file)
      return res.status(400).json({ error: "Live image (image2) is required" });

    const aadhaarResponse = await fetch(aadhaarUrl);
    if (!aadhaarResponse.ok)
      return res.status(400).json({ error: "Failed to download Aadhaar image" });

    const aadhaarBuffer = Buffer.from(await aadhaarResponse.arrayBuffer());
    const liveBuffer = fs.readFileSync(req.file.path);

    // Clean up uploaded file
    fs.unlink(req.file.path, () => {});

    const params = {
      SourceImage: { Bytes: aadhaarBuffer },
      TargetImage: { Bytes: liveBuffer },
      SimilarityThreshold: 50,
    };

    rekognitionV2.compareFaces(params, (err, data) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (data.FaceMatches && data.FaceMatches.length > 0) {
        const similarity = data.FaceMatches[0].Similarity;
        return res.json({
          matchFound: true,
          success: true,
          isMatch: similarity > 80,
          similarity: Math.round(similarity * 100) / 100,
        });
      }
      res.json({
        matchFound: false,
        success: false,
        isMatch: false,
        similarity: 0,
      });
    });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// ======================================================
// 2) COMPARE TWO UPLOADED IMAGES
// ======================================================
app.post(
  "/compare-images",
  upload.fields([
    { name: "image1", maxCount: 1 },
    { name: "image2", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      if (!req.files || !req.files.image1 || !req.files.image2) {
        return res
          .status(400)
          .json({ error: "Both image1 and image2 are required" });
      }

      const image1Buffer = fs.readFileSync(req.files.image1[0].path);
      const image2Buffer = fs.readFileSync(req.files.image2[0].path);

      // Clean up uploaded files
      fs.unlink(req.files.image1[0].path, () => {});
      fs.unlink(req.files.image2[0].path, () => {});

      const params = {
        SourceImage: { Bytes: image1Buffer },
        TargetImage: { Bytes: image2Buffer },
        SimilarityThreshold: 50,
      };

      rekognitionV2.compareFaces(params, (err, data) => {
        if (err) {
          return res.status(500).json({ error: err.message });
        }

        if (data.FaceMatches && data.FaceMatches.length > 0) {
          const similarity = data.FaceMatches[0].Similarity;
          return res.json({
            matchFound: true,
            success: true,
            isMatch: similarity > 80,
            similarity: Math.round(similarity * 100) / 100,
            confidence: Math.round(similarity * 100) / 100,
            faceMatches: data.FaceMatches.length,
          });
        }

        res.json({
          matchFound: false,
          success: false,
          isMatch: false,
          similarity: 0,
          confidence: 0,
          faceMatches: 0,
        });
      });
    } catch (error) {
      res
        .status(500)
        .json({ error: "Internal server error", details: error.message });
    }
  }
);

// ======================================================
// 3) CREATE LIVENESS SESSION
// ======================================================
app.get("/liveness/create", async (req, res) => {
  try {
    const createCmd = new CreateFaceLivenessSessionCommand({});
    const createResp = await rekogV3.send(createCmd);

    if (!createResp.SessionId) {
      return res.status(500).json({ error: "Failed to create liveness session" });
    }

    // Get session token
    const tokenResp = await stsV2
      .getSessionToken({ DurationSeconds: 900 })
      .promise();

    return res.json({
      sessionId: createResp.SessionId,
      region: AWS_REGION,
      identity: {
        accessKeyId: tokenResp.Credentials.AccessKeyId,
        secretAccessKey: tokenResp.Credentials.SecretAccessKey,
        sessionToken: tokenResp.Credentials.SessionToken,
        expiration: new Date(tokenResp.Credentials.Expiration),
      },
    });
  } catch (err) {
    return res.status(500).json({
      error: "Failed to create liveness session",
      details: err.message,
    });
  }
});

// ======================================================
// 4) GET LIVENESS RESULT
// ======================================================
app.get("/liveness/result/:sessionId", async (req, res) => {
  try {
    const cmd = new GetFaceLivenessSessionResultsCommand({
      SessionId: req.params.sessionId,
    });
    const result = await rekogV3.send(cmd);
    return res.json(result);
  } catch (err) {
    return res.status(500).json({
      error: "Failed to fetch liveness result",
      details: err.message,
    });
  }
});

// Health check
app.get("/health", (req, res) => {
  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    service: "Face Matcher API with AWS Rekognition Liveness",
  });
});

// ======================================================
// START SERVER
// ======================================================
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
  console.log(`AWS_REGION=${AWS_REGION}`);
});