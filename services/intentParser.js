/**
 * Natural Language Intent Parser — Enhanced v2
 * Maps user prompts to structured AWS actions.
 * Handles casual English, Yoda-style, and verbose phrasings.
 */

const { getRegion } = require('./awsClient');

function parseIntent(prompt) {
    const p = prompt.toLowerCase().trim();

    // ─── S3 ──────────────────────────────────────────────────────────
    if (/s3|bucket|storage|object|upload|download/.test(p)) {
        if (/create|make|new|add|setup|build/.test(p) && /(bucket|s3)/.test(p)) {
            return { service: 'S3', action: 'CreateBucket', params: { name: extractBucketName(p), region: extractRegion(p) }, raw: prompt };
        }
        if (/delete|remove|destroy|drop/.test(p) && /bucket/.test(p)) {
            return { service: 'S3', action: 'DeleteBucket', params: { name: extractBucketName(p) }, raw: prompt };
        }
        if (/upload|put/.test(p) && /(object|file)/.test(p)) {
            return { service: 'S3', action: 'PutObject', params: { bucket: extractBucketName(p) }, raw: prompt };
        }
        if (/delete|remove/.test(p) && /(object|file|key)/.test(p)) {
            return { service: 'S3', action: 'DeleteObject', params: { bucket: extractBucketName(p), key: extractObjectKey(p) }, raw: prompt };
        }
        // Storage / size / usage queries → ListObjects so Gemini can calculate total size
        if (/storage|size|how big|how much|space|used|usage|capacity|bytes|mb|gb|kb/.test(p)) {
            const bucket = extractBucketName(p);
            return { service: 'S3', action: 'ListObjects', params: { bucket }, raw: prompt };
        }
        if (/(list|show|get|display)/.test(p) && /(object|file|content)/.test(p)) {
            return { service: 'S3', action: 'ListObjects', params: { bucket: extractBucketName(p) }, raw: prompt };
        }
        return { service: 'S3', action: 'ListBuckets', params: {}, raw: prompt };
    }


    // ─── Lambda ───────────────────────────────────────────────────────
    if (/lambda|function|serverless|trigger/.test(p)) {
        if (/create|make|new|add|setup|build|want to create|i need|deploy/.test(p)) {
            const name = extractFunctionName(p);
            const runtime = extractRuntime(p);
            const region = extractRegion(p);
            const role = extractRoleArn(p);
            return { service: 'Lambda', action: 'CreateFunction', params: { name, runtime, region, role }, raw: prompt };
        }
        if (/delete|remove|destroy|drop/.test(p)) {
            return { service: 'Lambda', action: 'DeleteFunction', params: { name: extractFunctionName(p) }, raw: prompt };
        }
        if (/invoke|run|execute|trigger|call|test/.test(p)) {
            return { service: 'Lambda', action: 'InvokeFunction', params: { name: extractFunctionName(p) }, raw: prompt };
        }
        if (/(get|describe|detail|info)/.test(p)) {
            return { service: 'Lambda', action: 'GetFunction', params: { name: extractFunctionName(p) }, raw: prompt };
        }
        return { service: 'Lambda', action: 'ListFunctions', params: {}, raw: prompt };
    }

    // ─── EC2 ──────────────────────────────────────────────────────────
    if (/ec2|instance|server|virtual machine|\bvm\b/.test(p)) {
        if (/start|launch|boot|turn on|power on/.test(p)) {
            return { service: 'EC2', action: 'StartInstance', params: { instanceId: extractInstanceId(p) }, raw: prompt };
        }
        if (/stop|terminate|halt|shutdown|turn off|power off/.test(p)) {
            return { service: 'EC2', action: 'StopInstance', params: { instanceId: extractInstanceId(p) }, raw: prompt };
        }
        if (/get|describe|detail|info/.test(p)) {
            return { service: 'EC2', action: 'DescribeInstance', params: { instanceId: extractInstanceId(p) }, raw: prompt };
        }
        return { service: 'EC2', action: 'ListInstances', params: {}, raw: prompt };
    }

    // ─── IAM ──────────────────────────────────────────────────────────
    // Access key detection FIRST (before generic 'access' match)
    if (/access.?key|secret.?key|generate.?key|create.?key/.test(p)) {
        if (/delete|remove|deactivate/.test(p)) {
            return { service: 'IAM', action: 'DeleteAccessKey', params: { username: extractUsername(p), keyId: extractKeyId(p) }, raw: prompt };
        }
        if (/list|show|get|my/.test(p)) {
            return { service: 'IAM', action: 'ListAccessKeys', params: { username: extractUsername(p) }, raw: prompt };
        }
        // create / generate
        return { service: 'IAM', action: 'CreateAccessKey', params: { username: extractUsername(p) }, raw: prompt };
    }

    if (/\biam\b|\buser\b|role|policy|permission/.test(p)) {
        // Role operations
        if (/role/.test(p)) {
            if (/create|make|new|add/.test(p)) {
                return { service: 'IAM', action: 'CreateRole', params: { name: extractGenericName(p, ['role']), service: extractServiceName(p) }, raw: prompt };
            }
            if (/delete|remove/.test(p)) {
                return { service: 'IAM', action: 'DeleteRole', params: { name: extractGenericName(p, ['role']) }, raw: prompt };
            }
            if (/attach|add.?polic|grant/.test(p)) {
                return { service: 'IAM', action: 'AttachPolicy', params: { name: extractGenericName(p, ['role', 'to']) }, raw: prompt };
            }
            return { service: 'IAM', action: 'ListRoles', params: {}, raw: prompt };
        }
        if (/polic/.test(p)) return { service: 'IAM', action: 'ListPolicies', params: {}, raw: prompt };
        return { service: 'IAM', action: 'ListUsers', params: {}, raw: prompt };
    }

    // ─── DynamoDB ─────────────────────────────────────────────────────
    if (/dynamo|dynamodb|nosql|table|item/.test(p)) {
        if (/create|make|new|setup/.test(p) && /table/.test(p)) {
            return { service: 'DynamoDB', action: 'CreateTable', params: { name: extractGenericName(p, ['table']) }, raw: prompt };
        }
        if (/put|insert|add/.test(p) && /item/.test(p)) {
            return { service: 'DynamoDB', action: 'PutItem', params: { table: extractGenericName(p, ['table', 'in', 'into']) }, raw: prompt };
        }
        if (/get|list|scan|fetch|show/.test(p) && /item/.test(p)) {
            return { service: 'DynamoDB', action: 'ScanItems', params: { table: extractGenericName(p, ['table', 'from', 'in']) }, raw: prompt };
        }
        return { service: 'DynamoDB', action: 'ListTables', params: {}, raw: prompt };
    }

    // ─── SQS ──────────────────────────────────────────────────────────
    if (/\bsqs\b|queue|send message/.test(p)) {
        if (/create|make|new/.test(p)) {
            return { service: 'SQS', action: 'CreateQueue', params: { name: extractGenericName(p, ['queue']) }, raw: prompt };
        }
        if (/send|publish/.test(p)) return { service: 'SQS', action: 'SendMessage', params: {}, raw: prompt };
        if (/receive|read|poll/.test(p)) return { service: 'SQS', action: 'ReceiveMessages', params: {}, raw: prompt };
        return { service: 'SQS', action: 'ListQueues', params: {}, raw: prompt };
    }

    // ─── SNS ──────────────────────────────────────────────────────────
    if (/\bsns\b|topic|notification|subscribe|publish/.test(p)) {
        if (/create|make|new/.test(p)) {
            return { service: 'SNS', action: 'CreateTopic', params: { name: extractGenericName(p, ['topic']) }, raw: prompt };
        }
        if (/publish|send/.test(p)) return { service: 'SNS', action: 'Publish', params: {}, raw: prompt };
        if (/subscribe/.test(p)) return { service: 'SNS', action: 'Subscribe', params: {}, raw: prompt };
        return { service: 'SNS', action: 'ListTopics', params: {}, raw: prompt };
    }

    // ─── CloudWatch ───────────────────────────────────────────────────
    if (/cloudwatch|metric|alarm|log|monitor/.test(p)) {
        if (/alarm/.test(p)) return { service: 'CloudWatch', action: 'ListAlarms', params: {}, raw: prompt };
        if (/data|get|fetch/.test(p)) return { service: 'CloudWatch', action: 'GetMetricData', params: {}, raw: prompt };
        return { service: 'CloudWatch', action: 'ListMetrics', params: {}, raw: prompt };
    }

    // ─── Fallback ─────────────────────────────────────────────────────
    return { service: null, action: null, params: {}, raw: prompt };
}

// ─── Name Extractors ──────────────────────────────────────────────

/**
 * Universal name extractor — handles all common NL patterns:
 * "in the name of X", "named X", "called X", "name X",
 * "named 'X'", contextWord X, quoted strings, CamelCase identifiers
 */
function extractGenericName(text, contextWords = []) {
    const t = text.trim();

    // 1. "in the name of X"  /  "by the name of X"
    const inNameOf = t.match(/(?:in|by)\s+the\s+name\s+of\s+["\']?([a-zA-Z0-9][a-zA-Z0-9_\-\s]{0,40})["\']?/i);
    if (inNameOf) return sanitize(inNameOf[1]);

    // 1b. "in my X" / "of my X" / "for my X" / "my X" (e.g. "storage in my kryptosdevbucket")
    const inMy = t.match(/(?:in|of|for|from)\s+my\s+([a-zA-Z0-9][a-zA-Z0-9_\-\.]{2,62})/i);
    if (inMy) return sanitize(inMy[1]);

    // 1c. "my X bucket" — user says "my kryptosdevbucket"
    const myX = t.match(/my\s+([a-zA-Z0-9][a-zA-Z0-9_\-\.]{2,62})(?:\s+bucket|\s+function|\s+table|\s+role|\s+queue)?/i);
    if (myX) return sanitize(myX[1]);

    // 2. Quoted string "X" or 'X'
    const quoted = t.match(/["']([^"']{1,50})["']/i);
    if (quoted) return sanitize(quoted[1]);

    // 3. Context-word proximity: "create a table named MyTable"
    for (const word of contextWords) {
        const pat = new RegExp(`\\b${word}\\b\\s+(?:named?|called?|is)?\\s*["\']?([a-zA-Z0-9][a-zA-Z0-9_\\-]{1,40})["\']?`, 'i');
        const m = t.match(pat);
        if (m) return sanitize(m[1]);
    }

    // 4. "named X" / "called X"
    const namedCalled = t.match(/(?:named?|called?)\s+["\']?([a-zA-Z0-9][a-zA-Z0-9_\-\s]{1,40})["\']?/i);
    if (namedCalled) return sanitize(namedCalled[1]);

    // 5. CamelCase or snake_case identifier after the last contextWord
    for (const word of contextWords) {
        const pat = new RegExp(`${word}\\s+([A-Z][a-zA-Z0-9]{2,}|[a-z][a-z0-9_\\-]{2,})`, 'i');
        const m = t.match(pat);
        if (m) return sanitize(m[1]);
    }

    return null;
}

/**
 * Lambda function name extractor — priority: "in the name of X" → quoted → named/called → "function X" → fallback
 */
function extractFunctionName(text) {
    const t = text.trim();

    // "in the name of X" — handles "test lambda", "TestLambda" etc.
    const inNameOf = t.match(/(?:in|by)\s+the\s+name\s+of\s+["\']?([a-zA-Z0-9][a-zA-Z0-9_\-\s]{0,40})["\']?/i);
    if (inNameOf) return sanitizeId(inNameOf[1]);

    // Quoted: "test lambda" → test-lambda
    const quoted = t.match(/["']([^"']{1,50})["']/i);
    if (quoted) return sanitizeId(quoted[1]);

    // "named/called X" (multi-word ok: "test lambda function")
    const namedCalled = t.match(/(?:named?|called?)\s+["\']?([a-zA-Z0-9][a-zA-Z0-9_\-\s]{1,40})["\']?/i);
    if (namedCalled) return sanitizeId(namedCalled[1]);

    // "function X" where X is not a stop word
    const afterFunction = t.match(/\bfunction\s+(?!named?|called?|in\b|the\b|my\b|a\b|an\b)([a-zA-Z][a-zA-Z0-9_\-\s]{1,39})/i);
    if (afterFunction) return sanitizeId(afterFunction[1]);

    // "lambda X" where X is not a stop word
    const afterLambda = t.match(/\blambda\s+(?!function|named?|called?|in\b|the\b|a\b|an\b)([a-zA-Z][a-zA-Z0-9_\-\s]{1,39})/i);
    if (afterLambda) return sanitizeId(afterLambda[1]);

    // Last resort: first CamelCase or snake_case word
    const camel = t.match(/\b([A-Z][a-zA-Z0-9]{2,})\b/);
    if (camel) return sanitizeId(camel[1]);

    return 'my-lambda-function';
}

function extractBucketName(text) {
    const t = text.trim();

    // "in the name of X"
    const inNameOf = t.match(/(?:in|by)\s+the\s+name\s+of\s+["\']?([a-z0-9][a-z0-9\-\.\s]{0,50})["\']?/i);
    if (inNameOf) return sanitizeS3(inNameOf[1]);

    // Quoted
    const quoted = t.match(/["']([^"']+)["']/i);
    if (quoted) return sanitizeS3(quoted[1]);

    // "bucket named/called X"
    const namedBucket = t.match(/bucket\s+(?:named?|called?)\s+([a-z0-9][a-z0-9\-\.]{1,61})/i);
    if (namedBucket) return sanitizeS3(namedBucket[1]);

    // "named/called X"
    const named = t.match(/(?:named?|called?)\s+([a-z0-9][a-z0-9\-\.]{2,61})/i);
    if (named) return sanitizeS3(named[1]);

    // "X bucket"
    const before = t.match(/\b([a-z][a-z0-9\-]{2,30})\s+bucket/i);
    if (before) return sanitizeS3(before[1]);

    // Contains "bucket" word in name
    const bucketWord = t.match(/\b([a-z][a-z0-9\-]{2,30}bucket[a-z0-9\-]{0,10})\b/i);
    if (bucketWord) return sanitizeS3(bucketWord[1]);

    return 'my-bucket';
}

function extractObjectKey(text) {
    const m = text.match(/(?:object|file|key)\s+(?:named?|called?)?\s*["']?([a-zA-Z0-9\/_\-\.]+)["']?/i)
        || text.match(/["']([^"']+)["']/i);
    return m ? m[1] : 'my-object';
}

function extractRoleArn(text) {
    // If user explicitly provides role ARN in their prompt
    const m = text.match(/(arn:aws:iam::[0-9]{12}:role\/[a-zA-Z0-9+=,.@_\-\/]+)/i);
    return m ? m[1] : null;
}

function extractInstanceId(text) {
    const m = text.match(/i-[0-9a-f]{8,17}/i);
    return m ? m[0] : null;
}

function extractRegion(text) {
    const regions = [
        'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2',
        'ap-south-1', 'ap-southeast-1', 'ap-southeast-2', 'ap-northeast-1', 'ap-northeast-2',
        'eu-west-1', 'eu-west-2', 'eu-central-1',
        'ca-central-1', 'sa-east-1', 'me-south-1', 'af-south-1'
    ];
    for (const r of regions) {
        if (text.includes(r)) return r;
    }
    return getRegion();
}

function extractRuntime(text) {
    const runtimeMap = {
        'python3.12': /python\s*3\.12/,
        'python3.11': /python\s*3\.11/,
        'python3.9': /python\s*3\.9/,
        'python3.8': /python\s*3\.8/,
        'nodejs20.x': /node(?:js)?\s*20/,
        'nodejs18.x': /node(?:js)?\s*18/,
        'nodejs16.x': /node(?:js)?\s*16/,
        'java21': /java\s*21/,
        'java17': /java\s*17/,
        'dotnet8': /\.?net\s*8/,
        'go1.x': /golang|go\s*1/,
        'ruby3.2': /ruby\s*3/,
    };
    for (const [rt, pat] of Object.entries(runtimeMap)) {
        if (pat.test(text)) return rt;
    }
    return 'python3.12';
}

// ─── Sanitizers ───────────────────────────────────────────────────

/** For Lambda/DynamoDB/SQS/SNS names: strip trailing stop-words, trim spaces → underscores */
function sanitize(str) {
    return str.trim()
        .replace(/\s+(function|lambda|table|queue|topic|bucket)?\s*$/i, '')
        .trim()
        .replace(/\s+/g, '_')
        .replace(/[^a-zA-Z0-9_\-]/g, '')
        .substring(0, 64) || 'my-resource';
}

/** For Lambda: also convert spaces → hyphens, enforce length */
function sanitizeId(str) {
    return str.trim()
        .replace(/\s+(function|lambda|table|queue|topic|bucket)?\s*$/i, '')
        .trim()
        .replace(/\s+/g, '-')
        .replace(/[^a-zA-Z0-9_\-]/g, '')
        .substring(0, 64) || 'my-function';
}

/** For S3: lowercase, replace spaces → hyphens, no invalid chars */
function sanitizeS3(str) {
    return str.trim()
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9\-\.]/g, '')
        .replace(/^[\-\.]+|[\-\.]+$/g, '')
        .substring(0, 63) || 'my-bucket';
}

/** Extract a username from phrases like 'for user maaran', 'for me', 'generate key for john' */
function extractUsername(text) {
    const t = text.trim();
    // 'for user X'
    const forUser = t.match(/for\s+user\s+([a-zA-Z0-9_\-\.@]+)/i);
    if (forUser) return forUser[1];
    // 'for X' (but exclude 'for me' - means current caller)
    const forX = t.match(/for\s+(?!me\b)([a-zA-Z0-9_\-\.@]{2,})/i);
    if (forX) return forX[1];
    return null; // null = current user (ListAccessKeys returns for caller)
}

/** Extract an access key ID from the prompt (AKIA...) */
function extractKeyId(text) {
    const match = text.match(/AKIA[A-Z0-9]{16}/i);
    return match ? match[0].toUpperCase() : null;
}

/** Extract a service name for trust policy (lambda, ec2, etc.) */
function extractServiceName(text) {
    if (/lambda/.test(text)) return 'lambda';
    if (/ec2|compute/.test(text)) return 'ec2';
    if (/ecs|fargate/.test(text)) return 'ecs-tasks';
    if (/api.?gateway/.test(text)) return 'apigateway';
    return 'lambda';
}

module.exports = {
    parseIntent,
    extractBucketName,
    extractGenericName,
    extractFunctionName,
    extractRegion,
    extractRuntime,
    extractRoleArn,
    extractUsername,
    extractKeyId
};
