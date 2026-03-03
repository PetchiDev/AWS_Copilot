const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const responseTime = require('response-time');
const morgan = require('morgan');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const s3Routes = require('./routes/s3');
const lambdaRoutes = require('./routes/lambda');
const ec2Routes = require('./routes/ec2');
const iamRoutes = require('./routes/iam');
const dynamoRoutes = require('./routes/dynamodb');
const sqsRoutes = require('./routes/sqs');
const snsRoutes = require('./routes/sns');
const cloudwatchRoutes = require('./routes/cloudwatch');
const nlpRoutes = require('./routes/nlp');

const app = express();
const PORT = process.env.PORT || 5000;

// ─── Security Middleware ────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));

// ─── Compression (reduces payload size for speed) ──────────────────
app.use(compression({ level: 6 }));

// ─── Response Time Header ──────────────────────────────────────────
app.use(responseTime((req, res, time) => {
  res.setHeader('X-Response-Time', `${time.toFixed(2)}ms`);
  if (time > 500) {
    console.warn(`⚠️  SLOW: ${req.method} ${req.originalUrl} - ${time.toFixed(2)}ms`);
  }
}));

// ─── CORS ──────────────────────────────────────────────────────────
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-aws-access-key', 'x-aws-secret-key', 'x-aws-region', 'x-aws-session-token'],
  credentials: true
}));

// ─── Rate Limiting ─────────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests. Please slow down.' }
});
app.use(limiter);

// ─── Body Parsing ──────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ─── Logging ───────────────────────────────────────────────────────
app.use(morgan(':method :url :status :res[content-length] - :response-time ms'));

// ─── Health Check ──────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    success: true,
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage()
  });
});

// ─── API Routes ────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/s3', s3Routes);
app.use('/api/lambda', lambdaRoutes);
app.use('/api/ec2', ec2Routes);
app.use('/api/iam', iamRoutes);
app.use('/api/dynamodb', dynamoRoutes);
app.use('/api/sqs', sqsRoutes);
app.use('/api/sns', snsRoutes);
app.use('/api/cloudwatch', cloudwatchRoutes);
app.use('/api/aws', nlpRoutes);

// ─── 404 Handler ───────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: `Route ${req.method} ${req.originalUrl} not found`,
    timestamp: new Date().toISOString()
  });
});

// ─── Global Error Handler ──────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('❌ Unhandled Error:', err);

  const awsError = parseAwsError(err);
  res.status(awsError.statusCode).json({
    success: false,
    error: awsError.message,
    code: awsError.code,
    timestamp: new Date().toISOString()
  });
});

// ─── AWS Error Parser ──────────────────────────────────────────────
function parseAwsError(err) {
  const code = err.name || err.Code || 'InternalError';
  const message = err.message || 'An unexpected error occurred';

  const statusMap = {
    'NoCredentialsError': 401,
    'CredentialsProviderError': 401,
    'InvalidSignatureException': 401,
    'AuthFailure': 401,
    'AccessDeniedException': 403,
    'NoSuchBucket': 404,
    'NoSuchKey': 404,
    'ResourceNotFoundException': 404,
    'BucketAlreadyExists': 409,
    'BucketAlreadyOwnedByYou': 409,
    'ResourceAlreadyExistsException': 409,
    'ServiceException': 500,
    'InternalError': 500
  };

  return {
    statusCode: statusMap[code] || 500,
    message,
    code
  };
}

// ─── Start Server ──────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 AWS Copilot Backend running on http://localhost:${PORT}`);
  console.log(`📋 Health check: http://localhost:${PORT}/health`);
  console.log(`⏱️  Response-time tracking: X-Response-Time header on all responses\n`);
});

module.exports = app;
