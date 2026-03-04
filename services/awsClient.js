/**
 * AWS Client Factory
 * Creates and caches AWS SDK clients per service per region.
 * Credentials injected dynamically from request context or environment.
 */

const { S3Client, GetBucketLocationCommand } = require('@aws-sdk/client-s3');
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

    // Check for Lambda-safe environment variables first
    const accessKeyId = process.env.APP_AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.APP_AWS_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY;
    const sessionToken = process.env.AWS_SESSION_TOKEN;

    if (accessKeyId && secretAccessKey) {
        return {
            accessKeyId,
            secretAccessKey,
            ...(sessionToken && { sessionToken })
        };
    }
    return null;
}

/**
 * Get region from stored credentials or environment
 */
function getRegion() {
    return (storedCredentials && storedCredentials.region) ||
        process.env.APP_AWS_REGION ||
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

/**
 * Enhanced S3 Getter: Resolves the actual region of a bucket to avoid PermanentRedirect
 */
async function getS3ClientForBucket(bucketName) {
    if (!bucketName) return getS3Client();

    try {
        const defaultClient = getS3Client();
        const data = await defaultClient.send(new GetBucketLocationCommand({ Bucket: bucketName }));
        // us-east-1 returns null/undefined or empty string
        const region = data.LocationConstraint || 'us-east-1';
        return getS3Client(region);
    } catch (err) {
        // Fallback to default if we can't get location (might be a 403 or already a redirect)
        return getS3Client();
    }
}
const getLambdaClient = (region) => getClient(LambdaClient, region);
const getEC2Client = (region) => getClient(EC2Client, region);
const getIAMClient = (region) => getClient(IAMClient, 'us-east-1'); // IAM is global
const getDynamoDBClient = (region) => getClient(DynamoDBClient, region);
const getSQSClient = (region) => getClient(SQSClient, region);
const getSNSClient = (region) => getClient(SNSClient, region);
const getCloudWatchClient = (region) => getClient(CloudWatchClient, region);

module.exports = {
    getS3Client,
    getS3ClientForBucket,
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
