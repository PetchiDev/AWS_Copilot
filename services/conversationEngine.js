/**
 * conversationEngine.js
 * Detects when a user's intent is clear but required parameters are missing.
 * Returns a natural language clarifying question instead of executing.
 * Also handles direct answers ("ap-south-1", "my-bucket-name") in context of prior intent.
 */

// ─── Required params per action ───────────────────────────────────
const REQUIRED_PARAMS = {
    // S3
    S3: {
        DeleteBucket: { name: 'Which S3 bucket do you want to delete? Please provide the bucket name.' },
        ListObjects: { name: 'Which S3 bucket should I list objects for? Please provide the bucket name.' },
        PutObject: { name: 'Which S3 bucket should I upload the object to? Please provide the bucket name.' },
        DeleteObject: { name: 'Which S3 bucket and object key? E.g., "bucket-name/path/to/file.txt"' },
    },
    // Lambda
    Lambda: {
        DeleteFunction: { name: 'Which Lambda function should I delete? Please provide the function name.' },
        InvokeFunction: { name: 'Which Lambda function should I invoke? Please provide the function name.' },
        GetFunction: { name: 'Which Lambda function details should I fetch? Please provide the function name.' },
    },
    // EC2
    EC2: {
        StartInstance: { instanceId: 'Which EC2 instance should I start? Please provide the instance ID (e.g., i-1234567890abcdef0).' },
        StopInstance: { instanceId: 'Which EC2 instance should I stop? Please provide the instance ID (e.g., i-1234567890abcdef0).' },
        DescribeInstance: { instanceId: 'Which EC2 instance should I describe? Please provide the instance ID.' },
    },
    // IAM
    IAM: {
        CreateRole: { name: 'What should the IAM role be named?' },
        DeleteRole: { name: 'Which IAM role should I delete? Please provide the role name.' },
        AttachPolicy: { name: 'Which IAM role should I attach the policy to? Please provide the role name.' },
        DeleteAccessKey: { keyId: 'Which Access Key ID should I delete? It starts with AKIA...' },
    },
    // DynamoDB
    DynamoDB: {
        DeleteTable: { name: 'Which DynamoDB table should I delete? Please provide the table name.' },
        PutItem: { table: 'Which DynamoDB table should I insert the item into? Please provide the table name.' },
        ScanItems: { table: 'Which DynamoDB table should I scan? Please provide the table name.' },
        GetItem: { table: 'Which DynamoDB table? Please provide the table name.' },
    },
};

// ─── Conversational shortcuts (partial answers the user might give) ─
const CLARIFICATION_EXTRACTORS = [
    // "the bucket is my-bucket" / "bucket name: my-bucket" / "my-bucket"
    { pattern: /(?:bucket(?:\s+name)?(?:\s+is)?[:\s]+)([a-z0-9][a-z0-9\-\.]{1,61}[a-z0-9])/i, key: 'name' },
    { pattern: /(?:function(?:\s+name)?(?:\s+is)?[:\s]+)([a-zA-Z0-9_\-]{1,64})/i, key: 'name' },
    { pattern: /(?:table(?:\s+name)?(?:\s+is)?[:\s]+)([a-zA-Z0-9_\-\.]{1,255})/i, key: 'name' },
    { pattern: /(?:role(?:\s+name)?(?:\s+is)?[:\s]+)([a-zA-Z0-9_\-\.]{1,64})/i, key: 'name' },
    { pattern: /(?:instance(?:[\s\-]?id)?[:\s]+)(i-[a-f0-9]{8,17})/i, key: 'instanceId' },
    { pattern: /\b(i-[a-f0-9]{8,17})\b/, key: 'instanceId' },
    { pattern: /\b(AKIA[A-Z0-9]{16})\b/, key: 'keyId' },
    // Plain resource name as the only input
    { pattern: /^([a-zA-Z0-9][a-zA-Z0-9_\-\.]{1,62})$/, key: '_generic' },
];

/**
 * Check whether a parsed intent is missing required params.
 * @returns {{ needsMoreInfo: boolean, question?: string, missingKey?: string }}
 */
function checkMissingParams(intent) {
    if (!intent?.service || !intent?.action) return { needsMoreInfo: false };

    const serviceRules = REQUIRED_PARAMS[intent.service];
    if (!serviceRules) return { needsMoreInfo: false };

    const actionRules = serviceRules[intent.action];
    if (!actionRules) return { needsMoreInfo: false };

    const params = intent.params || {};
    for (const [key, question] of Object.entries(actionRules)) {
        const val = params[key];
        if (!val || val === 'my-resource' || val === 'my-function' || val === 'my-bucket') {
            return { needsMoreInfo: true, question, missingKey: key };
        }
    }

    return { needsMoreInfo: false };
}

/**
 * When a pending intent exists and the user types a short clarification,
 * try to extract the missing param from their reply.
 * @param {string} userText - new user message
 * @param {Object} pendingIntent - the previously stored intent
 * @param {string} missingKey - the param key we were asking about
 * @returns {Object|null} merged intent with filled param, or null if can't extract
 */
function resolveClarification(userText, pendingIntent, missingKey) {
    const text = userText.trim();

    for (const extractor of CLARIFICATION_EXTRACTORS) {
        const match = text.match(extractor.pattern);
        if (match) {
            const resolvedKey = extractor.key === '_generic' ? missingKey : extractor.key;
            if (!resolvedKey || resolvedKey !== missingKey && extractor.key !== '_generic') continue;
            const resolvedValue = match[1];
            return {
                ...pendingIntent,
                params: {
                    ...(pendingIntent.params || {}),
                    [missingKey]: resolvedValue,
                    [resolvedKey]: resolvedValue
                }
            };
        }
    }

    // If nothing matched, try the entire text as the param value (single-word answers)
    if (/^[a-zA-Z0-9][a-zA-Z0-9_\-\.]{0,62}$/.test(text)) {
        return {
            ...pendingIntent,
            params: {
                ...(pendingIntent.params || {}),
                [missingKey]: text
            }
        };
    }

    return null;
}

// ─── Special conversational questions (non-AWS actions) ───────────
const CONVERSATIONAL_RESPONSES = [
    // Cost / bill questions
    {
        pattern: /cost|bill|spend|charge|pricing/i,
        response: `💡 To analyze your AWS costs, I need a bit more detail. Could you tell me:

1. **Which service?** (S3, Lambda, EC2, DynamoDB...)
2. **Which resource?** (specific bucket name, function name, etc.)
3. **What time period?** (this month, last 7 days...)

For example: *"What is the CloudWatch metric for my S3 bucket named my-data-lake?"*` },

    // Help / what can you do
    {
        pattern: /^(help|what can you do|what do you support|capabilities|services)/i,
        response: `🚀 I can help you manage these AWS services using plain English:

| Service | Example Commands |
|---|---|
| **S3** | List buckets, create bucket, upload object |
| **Lambda** | Create function, invoke, list, delete |
| **EC2** | List instances, start, stop |
| **IAM** | Create role, attach policy, create access key |
| **DynamoDB** | Create table, put item, scan |
| **SQS** | Create queue, send message |
| **CloudWatch** | List alarms, list metrics |

Just describe what you need in plain English! 💬` },

    // Greeting
    {
        pattern: /^(hi|hello|hey|good morning|good afternoon|namaste|vanakam)/i,
        response: `👋 Hello! I'm your AWS Copilot. I'm here to help you manage your AWS infrastructure using natural language.\n\nWhat would you like to do today?`
    },
];

function checkConversational(prompt) {
    for (const item of CONVERSATIONAL_RESPONSES) {
        if (item.pattern.test(prompt.trim())) {
            return item.response;
        }
    }
    return null;
}

module.exports = { checkMissingParams, resolveClarification, checkConversational };
