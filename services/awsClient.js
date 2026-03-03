/**
 * AWS Client Factory
 * Creates and caches AWS SDK clients per service per region.
 * Credentials injected dynamically from request context or environment.
 */

const { S3Client } = require('@aws-sdk/client-s3');
const { LambdaClient } = require('@aws-sdk/client-lambda');
const { EC2Client } = require('@aws-sdk/client-ec2');
const { IAMClient } = require('@aws-sdk/client-iam');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { SQSClient } = require('@aws-sdk/client-sqs');
const { SNSClient } = require('@aws-sdk/client-sns');
const { CloudWatchClient } = require('@aws-sdk/client-cloudwatch');

// In-memory credential store (per-instance, not persistent across restarts)
let storedCredentials = null;

const clientCache = new Map();

/**
 * Get AWS credentials from stored credentials or environment variables
 */
function getCredentials() {
    if (storedCredentials) {
        return {
            accessKeyId: storedCredentials.accessKeyId,
            secretAccessKey: storedCredentials.secretAccessKey,
            ...(storedCredentials.sessionToken && { sessionToken: storedCredentials.sessionToken })
        };
    }
    if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
        return {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
            ...(process.env.AWS_SESSION_TOKEN && { sessionToken: process.env.AWS_SESSION_TOKEN })
        };
    }
    return null;
}

/**
 * Get region from stored credentials or environment
 */
function getRegion() {
    return (storedCredentials && storedCredentials.region) ||
        process.env.AWS_REGION ||
        'ap-south-1';
}

/**
 * Check if AWS credentials are configured
 */
function isConfigured() {
    const creds = getCredentials();
    return !!(creds && creds.accessKeyId && creds.secretAccessKey);
}

/**
 * Set credentials (from API call)
 */
function setCredentials(creds) {
    storedCredentials = {
        accessKeyId: creds.accessKeyId,
        secretAccessKey: creds.secretAccessKey,
        region: creds.region || 'ap-south-1',
        sessionToken: creds.sessionToken || null
    };
    // Clear client cache when credentials change
    clientCache.clear();
}

/**
 * Clear stored credentials
 */
function clearCredentials() {
    storedCredentials = null;
    clientCache.clear();
}

/**
 * Get cached AWS client or create new one
 */
function getClient(ServiceClient, region) {
    const r = region || getRegion();
    const cacheKey = `${ServiceClient.name}-${r}`;

    if (!clientCache.has(cacheKey)) {
        const credentials = getCredentials();
        if (!credentials) {
            throw Object.assign(new Error('AWS credentials not configured. Please configure your AWS credentials first.'), {
                name: 'NoCredentialsError',
                statusCode: 401
            });
        }
        clientCache.set(cacheKey, new ServiceClient({
            region: r,
            credentials,
            maxAttempts: 3
        }));
    }
    return clientCache.get(cacheKey);
}

// ─── Service-Specific Client Getters ───────────────────────────────

const getS3Client = (region) => getClient(S3Client, region);
const getLambdaClient = (region) => getClient(LambdaClient, region);
const getEC2Client = (region) => getClient(EC2Client, region);
const getIAMClient = (region) => getClient(IAMClient, 'us-east-1'); // IAM is global
const getDynamoDBClient = (region) => getClient(DynamoDBClient, region);
const getSQSClient = (region) => getClient(SQSClient, region);
const getSNSClient = (region) => getClient(SNSClient, region);
const getCloudWatchClient = (region) => getClient(CloudWatchClient, region);

module.exports = {
    getS3Client,
    getLambdaClient,
    getEC2Client,
    getIAMClient,
    getDynamoDBClient,
    getSQSClient,
    getSNSClient,
    getCloudWatchClient,
    isConfigured,
    setCredentials,
    clearCredentials,
    getRegion,
    getCredentials
};
