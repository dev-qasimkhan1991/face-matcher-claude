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
const https = require("https");
const http = require("http");
const dns = require("dns").promises;

// ============================================
// CONFIGURATION
// ============================================

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const AWS_REGION = process.env.AWS_REGION || "us-east-1";

const app = express();

// Trust proxy - CRITICAL for Plesk/Nginx deployments
app.set('trust proxy', true);

// Disable X-Powered-By header for security
app.disable('x-powered-by');

// ============================================
// UNIVERSAL CORS - MAXIMUM COMPATIBILITY
// ============================================

const corsOptions = {
  origin: function (origin, callback) {
    // CRITICAL: Always allow requests regardless of origin
    callback(null, true);
  },
  credentials: false,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "HEAD", "PATCH"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Requested-With",
    "Accept",
    "Origin",
    "Access-Control-Request-Method",
    "Access-Control-Request-Headers",
    "Cache-Control",
    "Pragma",
  ],
  exposedHeaders: ["Content-Type", "Content-Length", "X-Request-Id"],
  maxAge: 86400,
  optionsSuccessStatus: 200, // Changed from 204 for older browsers
  preflightContinue: false,
};

app.use(cors(corsOptions));

// Handle ALL OPTIONS requests BEFORE any other middleware
app.use((req, res, next) => {
  if (req.method === 'OPTIONS') {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS,HEAD,PATCH");
    res.header("Access-Control-Allow-Headers", "*");
    res.header("Access-Control-Max-Age", "86400");
    res.header("Access-Control-Allow-Credentials", "false");
    return res.sendStatus(200);
  }
  next();
});

// Global CORS headers for ALL responses
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Credentials", "false");
  res.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS,HEAD,PATCH");
  res.header("Access-Control-Allow-Headers", "*");
  res.header("Access-Control-Expose-Headers", "Content-Type,Content-Length,X-Request-Id");
  res.header("Access-Control-Max-Age", "86400");
  
  // Add cache control headers
  res.header("Cache-Control", "no-cache, no-store, must-revalidate");
  res.header("Pragma", "no-cache");
  res.header("Expires", "0");
  
  // Add request ID for tracking
  req.id = Date.now().toString(36) + Math.random().toString(36).substring(2);
  res.header("X-Request-Id", req.id);
  
  next();
});

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// ============================================
// REQUEST LOGGING MIDDLEWARE
// ============================================

app.use((req, res, next) => {
  const startTime = Date.now();
  
  console.log('\n' + '='.repeat(70));
  console.log(`📥 REQUEST [${req.id}]`);
  console.log('='.repeat(70));
  console.log('Method:', req.method);
  console.log('Path:', req.path);
  console.log('Origin:', req.headers.origin || 'NO ORIGIN');
  console.log('User-Agent:', req.headers['user-agent'] || 'UNKNOWN');
  console.log('IP:', req.ip);
  console.log('X-Forwarded-For:', req.headers['x-forwarded-for'] || 'NONE');
  console.log('X-Real-IP:', req.headers['x-real-ip'] || 'NONE');
  console.log('Accept:', req.headers['accept'] || 'NONE');
  console.log('Referer:', req.headers['referer'] || 'NONE');
  
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    console.log(`✅ Response: ${res.statusCode} (${duration}ms)`);
    console.log('='.repeat(70) + '\n');
  });
  
  next();
});

// ============================================
// AWS SDK CONFIGURATION
// ============================================

AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: AWS_REGION,
  maxRetries: 3,
  httpOptions: {
    timeout: 30000,
    connectTimeout: 5000,
  },
});

const rekognitionV2 = new AWS.Rekognition();
const stsV2 = new AWS.STS({ region: AWS_REGION });
const rekogV3 = new RekognitionClient({ region: AWS_REGION });

// ============================================
// MULTER UPLOAD CONFIGURATION
// ============================================

const uploadsDir = path.resolve(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  fs.chmodSync(uploadsDir, 0o755);
}

const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (req, file, cb) => {
    const filename = Date.now() + "-" + Math.random().toString(36).substring(7) + path.extname(file.originalname);
    cb(null, filename);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ["image/png", "image/jpg", "image/jpeg"];
    if (!allowed.includes(file.mimetype)) {
      cb(null, false);
      return;
    }
    cb(null, true);
  },
});

// ============================================
// UNIVERSAL FETCH - HANDLES ALL EDGE CASES
// ============================================

async function universalFetch(url, options = {}, maxRetries = 3) {
  // Create multiple agent configurations for different scenarios
  const httpsAgents = [
    // Agent 1: Standard with TLS 1.2+
    new https.Agent({
      rejectUnauthorized: false,
      keepAlive: true,
      timeout: 30000,
      secureProtocol: 'TLSv1_2_method',
      maxVersion: 'TLSv1.3',
      minVersion: 'TLSv1.2',
    }),
    // Agent 2: Legacy TLS 1.0/1.1 support for older devices
    new https.Agent({
      rejectUnauthorized: false,
      keepAlive: true,
      timeout: 30000,
      secureProtocol: 'TLS_method',
    }),
    // Agent 3: No specific protocol (let Node.js decide)
    new https.Agent({
      rejectUnauthorized: false,
      keepAlive: true,
      timeout: 30000,
    }),
  ];

  const httpAgent = new http.Agent({
    keepAlive: true,
    timeout: 30000,
  });

  // Try DNS resolution first
  let resolvedIP = null;
  try {
    const urlObj = new URL(url);
    const addresses = await dns.resolve4(urlObj.hostname);
    if (addresses && addresses.length > 0) {
      resolvedIP = addresses[0];
      console.log(`✅ DNS resolved ${urlObj.hostname} → ${resolvedIP}`);
    }
  } catch (dnsErr) {
    console.warn(`⚠️ DNS resolution failed: ${dnsErr.message}`);
  }

  // Try multiple strategies
  const strategies = [];
  
  // Strategy 1: Original URL with different agents
  httpsAgents.forEach((agent, index) => {
    strategies.push({
      url: url,
      agent: agent,
      description: `HTTPS Agent ${index + 1}`,
    });
  });

  // Strategy 2: Use resolved IP if available
  if (resolvedIP && url.startsWith('https://')) {
    const urlObj = new URL(url);
    const ipUrl = url.replace(urlObj.hostname, resolvedIP);
    httpsAgents.forEach((agent, index) => {
      strategies.push({
        url: ipUrl,
        agent: agent,
        description: `Direct IP ${resolvedIP} with Agent ${index + 1}`,
        headers: { ...options.headers, Host: urlObj.hostname },
      });
    });
  }

  // Strategy 3: HTTP fallback
  if (url.startsWith('https://')) {
    const httpUrl = url.replace('https://', 'http://');
    strategies.push({
      url: httpUrl,
      agent: httpAgent,
      description: 'HTTP Fallback',
    });
  }

  let lastError = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    for (const strategy of strategies) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      try {
        console.log(`🔄 Attempt ${attempt + 1}/${maxRetries} - ${strategy.description}`);
        console.log(`🔗 URL: ${strategy.url}`);

        const response = await fetch(strategy.url, {
          ...options,
          signal: controller.signal,
          agent: strategy.agent,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': '*/*',
            'Accept-Encoding': 'gzip, deflate, br',
            'Accept-Language': 'en-US,en;q=0.9',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Pragma': 'no-cache',
            ...strategy.headers,
            ...options.headers,
          },
          timeout: 30000,
        });

        clearTimeout(timeoutId);

        console.log(`✅ Success with ${strategy.description}: ${response.status}`);

        if (response.ok) {
          return response;
        }

        // Don't retry on definitive errors
        if (response.status === 404 || response.status === 403) {
          return response;
        }

        console.warn(`⚠️ ${strategy.description} returned ${response.status}`);

      } catch (error) {
        clearTimeout(timeoutId);
        console.error(`❌ ${strategy.description} failed:`, error.name, error.message);
        lastError = error;
      }

      // Small delay between strategies
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Exponential backoff between retry attempts
    if (attempt < maxRetries - 1) {
      const delay = Math.min(1000 * Math.pow(2, attempt), 5000);
      console.log(`⏳ Waiting ${delay}ms before retry...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError || new Error('All fetch strategies failed');
}

// ============================================
// HEALTH CHECK
// ============================================

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "OK",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "production",
    server: "Face Matcher API v3.0 - Universal Mobile",
    uptime: process.uptime(),
    version: "3.0.0",
  });
});

// ============================================
// COMPREHENSIVE DIAGNOSTIC ENDPOINT
// ============================================

app.get("/diagnose", async (req, res) => {
  const diagnostics = {
    timestamp: new Date().toISOString(),
    requestId: req.id,
    server: {
      version: "3.0.0",
      uptime: process.uptime(),
      nodeVersion: process.version,
      platform: process.platform,
    },
    client: {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      origin: req.headers.origin || 'NO ORIGIN',
      forwardedFor: req.headers['x-forwarded-for'] || 'NONE',
      realIp: req.headers['x-real-ip'] || 'NONE',
      referer: req.headers['referer'] || 'NONE',
      acceptLanguage: req.headers['accept-language'] || 'NONE',
    },
    dns: {},
    externalApiTest: null,
  };

  // Test DNS resolution
  try {
    const addresses = await dns.resolve4('testingpcmcpensioner.altwise.in');
    diagnostics.dns.resolved = true;
    diagnostics.dns.addresses = addresses;
  } catch (dnsErr) {
    diagnostics.dns.resolved = false;
    diagnostics.dns.error = dnsErr.message;
  }

  // Test external API
  try {
    const testUrl = "https://testingpcmcpensioner.altwise.in/api/aadhar/getCandidateDetails?ppoNumber=TEST";
    const response = await universalFetch(testUrl, { method: 'GET' }, 1);
    
    diagnostics.externalApiTest = {
      reachable: true,
      status: response.status,
      statusText: response.statusText,
    };
  } catch (err) {
    diagnostics.externalApiTest = {
      reachable: false,
      error: err.message,
    };
  }

  res.json(diagnostics);
});

// ============================================
// AADHAAR: GET CANDIDATE DETAILS - UNIVERSAL
// ============================================

app.get("/api/aadhar/getCandidateDetails", async (req, res) => {
  const requestId = req.id;
  
  try {
    const { ppoNumber } = req.query;

    console.log(`📋 [${requestId}] PPO Number:`, ppoNumber);

    if (!ppoNumber || !ppoNumber.trim()) {
      return res.status(400).json({
        success: false,
        error: "ppoNumber is required",
        requestId,
      });
    }

    const cleanPpoNumber = ppoNumber.trim();

    const baseUrl = "testingpcmcpensioner.altwise.in/api/aadhar/getCandidateDetails";
    const queryString = `?ppoNumber=${encodeURIComponent(cleanPpoNumber)}`;

    // Try multiple URL variations
    const urlVariations = [
      `https://${baseUrl}${queryString}`,
      `http://${baseUrl}${queryString}`,
    ];

    let lastError = null;

    for (const externalUrl of urlVariations) {
      try {
        console.log(`🔗 [${requestId}] Trying: ${externalUrl}`);

        const resp = await universalFetch(externalUrl, {
          method: "GET",
          headers: {
            "Accept": "application/json, text/plain, */*",
          },
        }, 2);

        console.log(`📊 [${requestId}] Response: ${resp.status}`);

        if (resp.status === 404) {
          return res.status(404).json({
            success: false,
            error: "PPO Number not found in the system",
            requestId,
          });
        }

        if (!resp.ok) {
          const errorText = await resp.text();
          console.warn(`⚠️ [${requestId}] HTTP ${resp.status}:`, errorText.substring(0, 200));
          lastError = new Error(`HTTP ${resp.status}`);
          continue;
        }

        const contentType = resp.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) {
          lastError = new Error("Invalid response format");
          continue;
        }

        const data = await resp.json();

        if (!data.success) {
          return res.status(400).json({
            success: false,
            error: data.message || "Failed to fetch Aadhaar details",
            requestId,
          });
        }

        if (!data.data || !data.data.aadhaarPhotoUrl) {
          return res.status(404).json({
            success: false,
            error: "No Aadhaar photo found for this PPO Number",
            requestId,
          });
        }

        console.log(`✅ [${requestId}] Success`);
        
        return res.json({
          success: true,
          data: data.data,
          message: data.message,
          requestId,
        });

      } catch (fetchErr) {
        console.error(`❌ [${requestId}] Failed:`, fetchErr.message);
        lastError = fetchErr;
        continue;
      }
    }

    console.error(`❌ [${requestId}] All attempts failed`);

    return res.status(502).json({
      success: false,
      error: "Unable to connect to Aadhaar service. Please try again.",
      details: lastError?.message || "Connection failed",
      requestId,
      suggestion: "Please check your internet connection and try again",
    });

  } catch (err) {
    console.error(`❌ [${requestId}] Error:`, err.message);

    res.status(500).json({
      success: false,
      error: "Internal server error",
      details: err.message,
      requestId,
    });
  }
});

// ============================================
// COMPARE FACES ENDPOINT
// ============================================

app.post(
  "/compare",
  upload.fields([
    { name: "image2", maxCount: 1 },
    { name: "aadhaarUrl", maxCount: 1 },
  ]),
  async (req, res) => {
    const requestId = req.id;
    
    try {
      console.log(`🔍 [${requestId}] Compare endpoint`);

      const aadhaarUrl = req.body?.aadhaarUrl || req.files?.aadhaarUrl?.[0];
      const liveFile = req.files?.image2?.[0];

      if (!aadhaarUrl) {
        return res.status(400).json({
          error: "aadhaarUrl is required",
          success: false,
          requestId,
        });
      }

      if (!liveFile) {
        return res.status(400).json({
          error: "Live image (image2) is required",
          success: false,
          requestId,
        });
      }

      console.log(`✅ [${requestId}] Fields present`);

      let aadhaarResponse;
      try {
        aadhaarResponse = await universalFetch(aadhaarUrl, {
          headers: {
            "Accept": "image/jpeg,image/png,image/*,*/*",
          },
        });

        if (!aadhaarResponse.ok) {
          throw new Error(`HTTP ${aadhaarResponse.status}`);
        }
      } catch (fetchErr) {
        console.error(`❌ [${requestId}] Aadhaar fetch failed:`, fetchErr.message);
        fs.unlink(liveFile.path, () => {});
        return res.status(400).json({
          error: "Failed to download Aadhaar image",
          success: false,
          requestId,
        });
      }

      const aadhaarBuffer = Buffer.from(await aadhaarResponse.arrayBuffer());
      const liveBuffer = fs.readFileSync(liveFile.path);
      fs.unlink(liveFile.path, () => {});

      console.log(`✅ [${requestId}] Images: ${aadhaarBuffer.length} + ${liveBuffer.length} bytes`);

      const params = {
        SourceImage: { Bytes: aadhaarBuffer },
        TargetImage: { Bytes: liveBuffer },
        SimilarityThreshold: 50,
      };

      rekognitionV2.compareFaces(params, (err, data) => {
        if (err) {
          console.error(`❌ [${requestId}] Rekognition error:`, err.message);
          return res.status(500).json({
            error: err.message,
            success: false,
            requestId,
          });
        }

        if (data.FaceMatches && data.FaceMatches.length > 0) {
          const similarity = data.FaceMatches[0].Similarity;
          console.log(`✅ [${requestId}] Match: ${similarity}%`);

          return res.json({
            matchFound: true,
            success: true,
            isMatch: similarity > 80,
            similarity: Math.round(similarity * 100) / 100,
            confidence: Math.round(similarity * 100) / 100,
            requestId,
          });
        }

        console.log(`❌ [${requestId}] No match`);
        res.json({
          matchFound: false,
          success: false,
          isMatch: false,
          similarity: 0,
          confidence: 0,
          requestId,
        });
      });

    } catch (error) {
      console.error(`❌ [${requestId}] Compare error:`, error.message);

      if (req.files?.image2?.[0]) {
        fs.unlink(req.files.image2[0].path, () => {});
      }

      res.status(500).json({
        error: "Internal server error",
        success: false,
        requestId,
      });
    }
  }
);

// ============================================
// LIVENESS: CREATE SESSION
// ============================================

app.get("/liveness/create", async (req, res) => {
  const requestId = req.id;
  
  try {
    console.log(`📡 [${requestId}] Creating liveness session`);

    const createCmd = new CreateFaceLivenessSessionCommand({});
    const createResp = await rekogV3.send(createCmd);

    if (!createResp.SessionId) {
      return res.status(500).json({
        error: "Failed to create liveness session",
        success: false,
        requestId,
      });
    }

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
        expiration: tokenResp.Credentials.Expiration.toISOString(),
      },
      requestId,
    });
  } catch (err) {
    console.error(`❌ [${requestId}] Liveness create error:`, err.message);
    return res.status(500).json({
      error: "Failed to create liveness session",
      success: false,
      requestId,
    });
  }
});

// ============================================
// LIVENESS: GET RESULT
// ============================================

app.get("/liveness/result/:sessionId", async (req, res) => {
  const requestId = req.id;
  
  try {
    const { sessionId } = req.params;
    console.log(`📡 [${requestId}] Liveness result: ${sessionId}`);

    const cmd = new GetFaceLivenessSessionResultsCommand({
      SessionId: sessionId,
    });

    const result = await rekogV3.send(cmd);
    console.log(`✅ [${requestId}] Status: ${result.Status}`);

    return res.json({ ...result, requestId });
  } catch (err) {
    console.error(`❌ [${requestId}] Liveness result error:`, err.message);
    return res.status(500).json({
      error: "Failed to fetch liveness result",
      success: false,
      requestId,
    });
  }
});

// ============================================
// 404 HANDLER
// ============================================

app.use((req, res) => {
  res.status(404).json({
    error: "Not Found",
    path: req.path,
    method: req.method,
    requestId: req.id,
  });
});

// ============================================
// ERROR HANDLER
// ============================================

app.use((err, req, res, next) => {
  console.error(`❌ [${req.id}] Unhandled error:`, err.message);

  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        success: false,
        error: "File size too large. Maximum is 10MB.",
        requestId: req.id,
      });
    }
    return res.status(400).json({
      success: false,
      error: err.message,
      requestId: req.id,
    });
  }

  res.status(err.status || 500).json({
    success: false,
    error: "Internal server error",
    requestId: req.id,
  });
});

// ============================================
// START SERVER
// ============================================

const server = app.listen(PORT, HOST, () => {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`🚀 Face Matcher Server v3.0 - Universal Mobile`);
  console.log(`📍 Listening on ${HOST}:${PORT}`);
  console.log(`🌍 AWS Region: ${AWS_REGION}`);
  console.log(`🔐 CORS: Universal (all origins, all methods)`);
  console.log(`⏰ Started: ${new Date().toISOString()}`);
  console.log(`${"=".repeat(70)}\n`);
});

// ============================================
// GRACEFUL SHUTDOWN
// ============================================

const gracefulShutdown = (signal) => {
  console.log(`\n${signal} received. Shutting down...`);

  server.close(() => {
    console.log("✅ Server closed");
    process.exit(0);
  });

  setTimeout(() => {
    console.error("❌ Forced shutdown");
    process.exit(1);
  }, 10000);
};

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

process.on("uncaughtException", (err) => {
  console.error("❌ Uncaught Exception:", err);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error("❌ Unhandled Rejection:", reason);
  process.exit(1);
});

module.exports = app;