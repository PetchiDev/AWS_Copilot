const express = require('express');
const router = express.Router();
const { parseIntent } = require('../services/intentParser');
const { isConfigured, getRegion } = require('../services/awsClient');
const { checkMissingParams, resolveClarification, checkConversational } = require('../services/conversationEngine');
const { analyzeWithGemini, generateClarifyingQuestion, handleConversational: geminiConversational } = require('../services/geminiService');

// AWS SDK commands
const { ListBucketsCommand, CreateBucketCommand, DeleteBucketCommand, ListObjectsV2Command, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { ListFunctionsCommand, GetFunctionCommand, CreateFunctionCommand, DeleteFunctionCommand, InvokeCommand } = require('@aws-sdk/client-lambda');
const { DescribeInstancesCommand, StartInstancesCommand, StopInstancesCommand } = require('@aws-sdk/client-ec2');
const { ListUsersCommand, ListRolesCommand, ListPoliciesCommand, CreateRoleCommand, DeleteRoleCommand, AttachRolePolicyCommand, DetachRolePolicyCommand, ListAttachedRolePoliciesCommand, GetRoleCommand, CreateAccessKeyCommand, ListAccessKeysCommand, DeleteAccessKeyCommand } = require('@aws-sdk/client-iam');

const { ListTablesCommand, CreateTableCommand, ScanCommand } = require('@aws-sdk/client-dynamodb');
const { ListQueuesCommand, CreateQueueCommand } = require('@aws-sdk/client-sqs');
const { ListTopicsCommand, CreateTopicCommand } = require('@aws-sdk/client-sns');
const { ListMetricsCommand, DescribeAlarmsCommand } = require('@aws-sdk/client-cloudwatch');

const {
    getS3Client, getLambdaClient, getEC2Client, getIAMClient,
    getDynamoDBClient, getSQSClient, getSNSClient, getCloudWatchClient
} = require('../services/awsClient');

// ─── Default Lambda placeholder code (Python) ──────────────────────
const DEFAULT_LAMBDA_CODE = (fnName) => `import json

def handler(event, context):
    print(f"Function: ${fnName}")
    print(f"Event: {json.dumps(event)}")
    return {
        'statusCode': 200,
        'body': json.dumps({
            'message': f'Hello from ${fnName}!',
            'input': event
        })
    }
`;

const LAMBDA_BASIC_EXEC_POLICY = 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole';
const COPILOT_LAMBDA_ROLE_NAME = 'AWSCopilotLambdaExecutionRole';

const LAMBDA_TRUST_POLICY = JSON.stringify({
    Version: '2012-10-17',
    Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }]
});

/**
 * Auto-detect OR auto-create a Lambda execution role.
 * 1. Look for existing role with 'lambda' in name / trust policy
 * 2. If none found → create 'AWSCopilotLambdaExecutionRole' and attach AWSLambdaBasicExecutionRole
 */
async function autoGetOrCreateLambdaRole() {
    try {
        const iamClient = getIAMClient();
        const data = await iamClient.send(new ListRolesCommand({ MaxItems: 100 }));
        const roles = data.Roles || [];

        // Priority 1: role with "lambda" in name AND lambda trust
        const lambdaRole = roles.find(r =>
            /lambda/i.test(r.RoleName) &&
            r.AssumeRolePolicyDocument &&
            decodeURIComponent(r.AssumeRolePolicyDocument).includes('lambda.amazonaws.com')
        );
        if (lambdaRole) return { arn: lambdaRole.Arn, created: false, roleName: lambdaRole.RoleName };

        // Priority 2: any role trusting lambda
        const anyLambda = roles.find(r =>
            r.AssumeRolePolicyDocument &&
            decodeURIComponent(r.AssumeRolePolicyDocument).includes('lambda.amazonaws.com')
        );
        if (anyLambda) return { arn: anyLambda.Arn, created: false, roleName: anyLambda.RoleName };

        // Priority 3: loose name match
        const loose = roles.find(r => /lambda/i.test(r.RoleName));
        if (loose) return { arn: loose.Arn, created: false, roleName: loose.RoleName };

        // ── No role found → AUTO-CREATE one ──────────────────────────────
        console.log('🔧 No Lambda role found — auto-creating AWSCopilotLambdaExecutionRole...');
        const created = await iamClient.send(new CreateRoleCommand({
            RoleName: COPILOT_LAMBDA_ROLE_NAME,
            AssumeRolePolicyDocument: LAMBDA_TRUST_POLICY,
            Description: 'Auto-created by AWS Copilot for Lambda execution'
        }));
        await iamClient.send(new AttachRolePolicyCommand({
            RoleName: COPILOT_LAMBDA_ROLE_NAME,
            PolicyArn: LAMBDA_BASIC_EXEC_POLICY
        }));
        // IAM propagation delay — wait 8s before Lambda can use the role
        await new Promise(r => setTimeout(r, 8000));
        return { arn: created.Role.Arn, created: true, roleName: COPILOT_LAMBDA_ROLE_NAME };
    } catch (err) {
        console.error('autoGetOrCreateLambdaRole error:', err.message);
        return null;
    }
}

/**
 * POST /api/aws/execute
 * Main NLP endpoint — parse prompt → execute AWS action → return result.
 */
router.post('/execute', async (req, res, next) => {
    const startTime = Date.now();
    try {
        const { prompt, region, context } = req.body;

        if (!prompt || !prompt.trim()) {
            return res.status(400).json({ success: false, error: 'prompt is required' });
        }

        if (!isConfigured()) {
            return res.status(401).json({
                success: false,
                error: 'AWS credentials not configured. Please login first.',
                code: 'NoCredentialsError',
                requiresAuth: true
            });
        }

        // ── Step 1: Check for conversational / non-AWS prompts ─────────
        const conversationalReply = checkConversational(prompt);
        if (conversationalReply) {
            return res.json({
                success: true,
                conversational: true,
                result: { message: conversationalReply },
                intent: { service: 'Copilot', action: 'Chat' },
                processingTimeMs: Date.now() - startTime,
                timestamp: new Date().toISOString()
            });
        }

        let intent;
        let r = region || getRegion();

        // ── Step 2: If we have a pending context, try to resolve it ────
        if (context?.pendingIntent && context?.missingKey) {
            const resolved = resolveClarification(prompt, context.pendingIntent, context.missingKey);
            if (resolved) {
                intent = resolved;
                r = resolved.params?.region || region || getRegion();
            }
        }

        // ── Step 3: If no context resolution, parse normally ──────────
        if (!intent) {
            intent = parseIntent(prompt);
            r = region || (intent.params?.region) || getRegion();
        }

        if (!intent.service || !intent.action) {
            return res.json({
                success: false,
                intent,
                error: 'I\'m not sure what you want to do. Could you rephrase that?',
                conversational: true,
                result: { message: 'I didn\'t quite understand that. Here are some things I can help you with:' },
                suggestions: [
                    'List all S3 buckets',
                    'Create an S3 bucket named my-bucket in ap-south-1',
                    'Create a Lambda function in the name of my-function',
                    'List Lambda functions',
                    'List EC2 instances',
                    'List DynamoDB tables',
                    'List IAM users',
                    'Show CloudWatch alarms'
                ]
            });
        }

        // ── Step 4: Check if required params are missing → ask the user (AI enhanced) ─
        const { needsMoreInfo, question, missingKey } = checkMissingParams(intent);
        if (needsMoreInfo) {
            // Let Gemini improve the clarifying question
            const smartQuestion = process.env.GEMINI_API_KEY
                ? await generateClarifyingQuestion(prompt, question, intent)
                : question;
            return res.json({
                success: true,
                needsMoreInfo: true,
                question: smartQuestion,
                pendingContext: { pendingIntent: intent, missingKey },
                intent,
                result: { message: smartQuestion },
                processingTimeMs: Date.now() - startTime,
                timestamp: new Date().toISOString()
            });
        }

        const result = await executeAction(intent, r);
        const processingTimeMs = Date.now() - startTime;

        // ── Step 5: Pass AWS data through Gemini for smart natural-language analysis ─
        let aiAnalysis = null;
        if (process.env.GEMINI_API_KEY && result) {
            aiAnalysis = await analyzeWithGemini(prompt, result, intent);
        }

        res.json({
            success: true,
            intent,
            result,
            aiAnalysis,        // Gemini's natural language answer
            region: r,
            processingTimeMs,
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        next(err);
    }
});

// ─── Action Executor ──────────────────────────────────────────────

async function executeAction(intent, region) {
    const { service, action, params } = intent;

    switch (service) {

        // ════════════════════════════════════════════════════════════════
        // S3
        // ════════════════════════════════════════════════════════════════
        case 'S3': {
            const client = getS3Client(region);
            switch (action) {
                case 'ListBuckets': {
                    const data = await client.send(new ListBucketsCommand({}));
                    return { buckets: data.Buckets || [], count: data.Buckets?.length || 0 };
                }
                case 'CreateBucket': {
                    const name = params.name || 'my-bucket';
                    const r = params.region || region;
                    const p = { Bucket: name };
                    if (r !== 'us-east-1') p.CreateBucketConfiguration = { LocationConstraint: r };
                    await client.send(new CreateBucketCommand(p));
                    return {
                        bucket: name, region: r,
                        arn: `arn:aws:s3:::${name}`,
                        consoleUrl: `https://s3.console.aws.amazon.com/s3/buckets/${name}`,
                        message: ` Bucket '${name}' created successfully in ${r}`
                    };
                }
                case 'DeleteBucket': {
                    await client.send(new DeleteBucketCommand({ Bucket: params.name }));
                    return { message: ` Bucket '${params.name}' deleted successfully` };
                }
                case 'ListObjects': {
                    const data = await client.send(new ListObjectsV2Command({ Bucket: params.bucket || params.name, MaxKeys: 100 }));
                    return { objects: data.Contents || [], count: data.KeyCount || 0, bucket: params.bucket || params.name };
                }
                case 'PutObject': {
                    await client.send(new PutObjectCommand({ Bucket: params.bucket, Key: params.key || 'new-object.txt', Body: '' }));
                    return { message: ` Object uploaded to '${params.bucket}'` };
                }
                case 'DeleteObject': {
                    await client.send(new DeleteObjectCommand({ Bucket: params.bucket, Key: params.key }));
                    return { message: ` Object '${params.key}' deleted from '${params.bucket}'` };
                }
            }
            break;
        }

        // ════════════════════════════════════════════════════════════════
        // Lambda
        // ════════════════════════════════════════════════════════════════
        case 'Lambda': {
            const client = getLambdaClient(region);

            switch (action) {
                case 'ListFunctions': {
                    const fns = [];
                    let marker;
                    do {
                        const data = await client.send(new ListFunctionsCommand({ Marker: marker, MaxItems: 50 }));
                        fns.push(...(data.Functions || []));
                        marker = data.NextMarker;
                    } while (marker);
                    return { functions: fns, count: fns.length };
                }

                case 'GetFunction': {
                    const data = await client.send(new GetFunctionCommand({ FunctionName: params.name }));
                    return { function: data.Configuration };
                }

                case 'CreateFunction': {
                    const fnName = params.name || 'my-lambda-function';
                    const runtime = params.runtime || 'python3.12';
                    const r = params.region || region;

                    // Step 1: Resolve IAM role — auto-detect OR auto-create
                    let roleInfo = null;
                    let roleArn = params.role;
                    if (!roleArn) {
                        roleInfo = await autoGetOrCreateLambdaRole();
                        roleArn = roleInfo?.arn || null;
                    }

                    if (!roleArn) {
                        return {
                            success: false,
                            message: `⚠️ Could not create or detect a Lambda execution role. Check IAM permissions.`
                        };
                    }

                    // Step 2: Build zip with placeholder Python code
                    const codeStr = DEFAULT_LAMBDA_CODE(fnName);
                    const zipBuffer = buildInMemoryZip('lambda_function.py', codeStr);

                    // Step 3: Create the function
                    const lClient = getLambdaClient(r);
                    const data = await lClient.send(new CreateFunctionCommand({
                        FunctionName: fnName,
                        Runtime: runtime,
                        Role: roleArn,
                        Handler: 'lambda_function.handler',
                        Description: `Created by AWS Copilot via natural language`,
                        Code: { ZipFile: zipBuffer },
                        Timeout: 30,
                        MemorySize: 128,
                        Environment: { Variables: { CREATED_BY: 'aws-copilot' } }
                    }));

                    return {
                        functionName: data.FunctionName,
                        functionArn: data.FunctionArn,
                        runtime: data.Runtime,
                        handler: data.Handler,
                        role: data.Role,
                        region: r,
                        state: data.State,
                        memorySize: data.MemorySize,
                        timeout: data.Timeout,
                        consoleUrl: `https://${r}.console.aws.amazon.com/lambda/home?region=${r}#/functions/${data.FunctionName}`,
                        message: ` Lambda function '${fnName}' created successfully!`,
                        roleAutoCreated: roleInfo?.created ? `Auto-created role '${roleInfo.roleName}' with AWSLambdaBasicExecutionRole` : undefined,
                        code: `# Default handler uploaded:\n${codeStr}`
                    };
                }

                case 'DeleteFunction': {
                    await client.send(new DeleteFunctionCommand({ FunctionName: params.name }));
                    return { message: ` Lambda function '${params.name}' deleted successfully` };
                }

                case 'InvokeFunction': {
                    const data = await client.send(new InvokeCommand({
                        FunctionName: params.name,
                        InvocationType: 'RequestResponse',
                        Payload: JSON.stringify({})
                    }));
                    const payload = data.Payload
                        ? (() => { try { return JSON.parse(Buffer.from(data.Payload).toString()); } catch { return null; } })()
                        : null;
                    return {
                        functionName: params.name,
                        statusCode: data.StatusCode,
                        executedVersion: data.ExecutedVersion,
                        functionError: data.FunctionError || null,
                        payload
                    };
                }
            }
            break;
        }

        // ════════════════════════════════════════════════════════════════
        // EC2
        // ════════════════════════════════════════════════════════════════
        case 'EC2': {
            const client = getEC2Client(region);
            switch (action) {
                case 'ListInstances': {
                    const data = await client.send(new DescribeInstancesCommand({}));
                    const instances = [];
                    for (const res of (data.Reservations || [])) {
                        for (const i of (res.Instances || [])) {
                            instances.push({
                                id: i.InstanceId, type: i.InstanceType,
                                state: i.State?.Name,
                                name: i.Tags?.find(t => t.Key === 'Name')?.Value || 'Unnamed',
                                publicIp: i.PublicIpAddress, privateIp: i.PrivateIpAddress
                            });
                        }
                    }
                    return { instances, count: instances.length };
                }
                case 'StartInstance': {
                    const data = await client.send(new StartInstancesCommand({ InstanceIds: [params.instanceId] }));
                    return { message: ` Instance '${params.instanceId}' is starting`, stateChange: data.StartingInstances?.[0] };
                }
                case 'StopInstance': {
                    const data = await client.send(new StopInstancesCommand({ InstanceIds: [params.instanceId] }));
                    return { message: ` Instance '${params.instanceId}' is stopping`, stateChange: data.StoppingInstances?.[0] };
                }
            }
            break;
        }

        // ════════════════════════════════════════════════════════════════
        // IAM
        // ════════════════════════════════════════════════════════════════
        case 'IAM': {
            const client = getIAMClient();
            switch (action) {
                case 'ListUsers': {
                    const data = await client.send(new ListUsersCommand({ MaxItems: 100 }));
                    return { users: data.Users || [], count: data.Users?.length || 0 };
                }
                case 'ListRoles': {
                    const data = await client.send(new ListRolesCommand({ MaxItems: 100 }));
                    return { roles: data.Roles || [], count: data.Roles?.length || 0 };
                }
                case 'ListPolicies': {
                    const data = await client.send(new ListPoliciesCommand({ Scope: 'Local', MaxItems: 100 }));
                    return { policies: data.Policies || [], count: data.Policies?.length || 0 };
                }
                case 'CreateRole': {
                    const roleName = params.name || 'AWSCopilotRole';
                    const service = params.service || 'lambda';
                    const trustPolicy = JSON.stringify({
                        Version: '2012-10-17',
                        Statement: [{ Effect: 'Allow', Principal: { Service: `${service}.amazonaws.com` }, Action: 'sts:AssumeRole' }]
                    });
                    const data = await client.send(new CreateRoleCommand({
                        RoleName: roleName,
                        AssumeRolePolicyDocument: trustPolicy,
                        Description: `Created by AWS Copilot`
                    }));
                    // Auto-attach basic policy for known services
                    const policyMap = {
                        lambda: LAMBDA_BASIC_EXEC_POLICY,
                        ec2: 'arn:aws:iam::aws:policy/AmazonEC2ReadOnlyAccess'
                    };
                    if (policyMap[service]) {
                        await client.send(new AttachRolePolicyCommand({ RoleName: roleName, PolicyArn: policyMap[service] }));
                    }
                    return {
                        roleId: data.Role.RoleId,
                        roleName: data.Role.RoleName,
                        arn: data.Role.Arn,
                        trustService: service,
                        message: ` IAM Role '${roleName}' created for ${service}`
                    };
                }
                case 'AttachPolicy': {
                    const policyArn = params.policyArn || LAMBDA_BASIC_EXEC_POLICY;
                    await client.send(new AttachRolePolicyCommand({ RoleName: params.name, PolicyArn: policyArn }));
                    return { message: ` Policy attached to role '${params.name}'`, policyArn };
                }
                case 'DeleteRole': {
                    // Detach all managed policies first
                    const attached = await client.send(new ListAttachedRolePoliciesCommand({ RoleName: params.name }));
                    await Promise.allSettled(
                        (attached.AttachedPolicies || []).map(p =>
                            client.send(new DetachRolePolicyCommand({ RoleName: params.name, PolicyArn: p.PolicyArn }))
                        )
                    );
                    await client.send(new DeleteRoleCommand({ RoleName: params.name }));
                    return { message: ` IAM Role '${params.name}' deleted successfully` };
                }

                // ── Access Key Operations ─────────────────────────────────────
                case 'CreateAccessKey': {
                    // If username given → create for that user, else create for current caller
                    const cmd = params.username
                        ? new CreateAccessKeyCommand({ UserName: params.username })
                        : new CreateAccessKeyCommand({});
                    const data = await client.send(cmd);
                    const key = data.AccessKey;
                    return {
                        username: key.UserName,
                        accessKeyId: key.AccessKeyId,
                        secretAccessKey: key.SecretAccessKey,
                        status: key.Status,
                        createdAt: key.CreateDate,
                        message: ` Access Key created for '${key.UserName}'`,
                        warning: '⚠️ Save the Secret Access Key now — it cannot be retrieved again!',
                        hint: 'Copy these credentials and use them in the Access Keys login tab to connect.'
                    };
                }

                case 'ListAccessKeys': {
                    const data = await client.send(
                        params.username
                            ? new ListAccessKeysCommand({ UserName: params.username })
                            : new ListAccessKeysCommand({})
                    );
                    return {
                        username: params.username || 'current user',
                        accessKeys: (data.AccessKeyMetadata || []).map(k => ({
                            accessKeyId: k.AccessKeyId,
                            status: k.Status,
                            createdAt: k.CreateDate
                        })),
                        count: data.AccessKeyMetadata?.length || 0
                    };
                }

                case 'DeleteAccessKey': {
                    if (!params.keyId) {
                        return { success: false, message: '⚠️ Please provide the Access Key ID to delete. Example: "Delete access key AKIAXXXXXXXXXXXXXXXX"' };
                    }
                    const delCmd = params.username
                        ? new DeleteAccessKeyCommand({ UserName: params.username, AccessKeyId: params.keyId })
                        : new DeleteAccessKeyCommand({ AccessKeyId: params.keyId });
                    await client.send(delCmd);
                    return { message: ` Access Key '${params.keyId}' deleted successfully` };
                }
            }
            break;
        }


        // ════════════════════════════════════════════════════════════════
        // DynamoDB
        // ════════════════════════════════════════════════════════════════
        case 'DynamoDB': {
            const client = getDynamoDBClient(region);
            switch (action) {
                case 'ListTables': {
                    const tables = [];
                    let lastKey;
                    do {
                        const data = await client.send(new ListTablesCommand({ ExclusiveStartTableName: lastKey, Limit: 100 }));
                        tables.push(...(data.TableNames || []));
                        lastKey = data.LastEvaluatedTableName;
                    } while (lastKey);
                    return { tables, count: tables.length };
                }
                case 'CreateTable': {
                    const data = await client.send(new CreateTableCommand({
                        TableName: params.name,
                        AttributeDefinitions: [{ AttributeName: 'id', AttributeType: 'S' }],
                        KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
                        BillingMode: 'PAY_PER_REQUEST'
                    }));
                    return { table: data.TableDescription, message: ` Table '${params.name}' created` };
                }
                case 'ScanItems': {
                    const data = await client.send(new ScanCommand({ TableName: params.table || params.name, Limit: 50 }));
                    return { items: data.Items || [], count: data.Count };
                }
            }
            break;
        }

        // ════════════════════════════════════════════════════════════════
        // SQS
        // ════════════════════════════════════════════════════════════════
        case 'SQS': {
            const client = getSQSClient(region);
            switch (action) {
                case 'ListQueues': {
                    const data = await client.send(new ListQueuesCommand({ MaxResults: 100 }));
                    return { queues: data.QueueUrls || [], count: data.QueueUrls?.length || 0 };
                }
                case 'CreateQueue': {
                    const data = await client.send(new CreateQueueCommand({ QueueName: params.name }));
                    return { queueUrl: data.QueueUrl, message: ` Queue '${params.name}' created` };
                }
                default:
                    return { message: `Use POST /api/sqs/queues/send or /receive for message operations` };
            }
        }

        // ════════════════════════════════════════════════════════════════
        // SNS
        // ════════════════════════════════════════════════════════════════
        case 'SNS': {
            const client = getSNSClient(region);
            switch (action) {
                case 'ListTopics': {
                    const topics = [];
                    let nextToken;
                    do {
                        const data = await client.send(new ListTopicsCommand({ NextToken: nextToken }));
                        topics.push(...(data.Topics || []));
                        nextToken = data.NextToken;
                    } while (nextToken);
                    return { topics, count: topics.length };
                }
                case 'CreateTopic': {
                    const data = await client.send(new CreateTopicCommand({ Name: params.name }));
                    return { topicArn: data.TopicArn, message: ` SNS topic '${params.name}' created` };
                }
                default:
                    return { message: `Use POST /api/sns/publish or /subscribe for message operations` };
            }
        }

        // ════════════════════════════════════════════════════════════════
        // CloudWatch
        // ════════════════════════════════════════════════════════════════
        case 'CloudWatch': {
            const client = getCloudWatchClient(region);
            switch (action) {
                case 'ListMetrics': {
                    const data = await client.send(new ListMetricsCommand({}));
                    return { metrics: (data.Metrics || []).slice(0, 50), count: data.Metrics?.length || 0 };
                }
                case 'ListAlarms': {
                    const data = await client.send(new DescribeAlarmsCommand({}));
                    const alarms = [...(data.MetricAlarms || []), ...(data.CompositeAlarms || [])];
                    return { alarms, count: alarms.length };
                }
            }
            break;
        }
    }

    return { message: `Action '${action}' on '${service}' executed. Check your AWS Console for results.` };
}

// ─── Minimal In-Memory ZIP Builder ───────────────────────────────
// Creates a valid ZIP file buffer with a single file — no native modules needed.
function buildInMemoryZip(filename, content) {
    const fileBytes = Buffer.from(content, 'utf8');
    const nameBytes = Buffer.from(filename, 'utf8');
    const crc = crc32(fileBytes);
    const now = new Date();
    const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);

    // Local file header
    const lfh = Buffer.alloc(30 + nameBytes.length);
    lfh.writeUInt32LE(0x04034b50, 0);  // Signature
    lfh.writeUInt16LE(20, 4);          // Version needed
    lfh.writeUInt16LE(0, 6);           // Flags
    lfh.writeUInt16LE(0, 8);           // Compression (stored)
    lfh.writeUInt16LE(dosTime, 10);
    lfh.writeUInt16LE(dosDate, 12);
    lfh.writeUInt32LE(crc, 14);
    lfh.writeUInt32LE(fileBytes.length, 18); // Compressed size
    lfh.writeUInt32LE(fileBytes.length, 22); // Uncompressed size
    lfh.writeUInt16LE(nameBytes.length, 26);
    lfh.writeUInt16LE(0, 28);          // Extra field length
    nameBytes.copy(lfh, 30);

    // Central directory header
    const cdh = Buffer.alloc(46 + nameBytes.length);
    cdh.writeUInt32LE(0x02014b50, 0);  // Signature
    cdh.writeUInt16LE(20, 4);          // Version made by
    cdh.writeUInt16LE(20, 6);          // Version needed
    cdh.writeUInt16LE(0, 8);           // Flags
    cdh.writeUInt16LE(0, 10);          // Compression
    cdh.writeUInt16LE(dosTime, 12);
    cdh.writeUInt16LE(dosDate, 14);
    cdh.writeUInt32LE(crc, 16);
    cdh.writeUInt32LE(fileBytes.length, 20);
    cdh.writeUInt32LE(fileBytes.length, 24);
    cdh.writeUInt16LE(nameBytes.length, 28);
    cdh.writeUInt16LE(0, 30);          // Extra
    cdh.writeUInt16LE(0, 32);          // Comment
    cdh.writeUInt16LE(0, 34);          // Disk start
    cdh.writeUInt16LE(0, 36);          // Internal attributes
    cdh.writeUInt32LE(0, 38);          // External attributes
    cdh.writeUInt32LE(0, 42);          // Relative offset of local header
    nameBytes.copy(cdh, 46);

    const centralDirOffset = lfh.length + fileBytes.length;
    const centralDirSize = cdh.length;

    // End of central directory
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0); // Signature
    eocd.writeUInt16LE(0, 4);          // Disk number
    eocd.writeUInt16LE(0, 6);          // Disk with central dir
    eocd.writeUInt16LE(1, 8);          // Entries on disk
    eocd.writeUInt16LE(1, 10);         // Total entries
    eocd.writeUInt32LE(centralDirSize, 12);
    eocd.writeUInt32LE(centralDirOffset, 16);
    eocd.writeUInt16LE(0, 20);         // Comment length

    return Buffer.concat([lfh, fileBytes, cdh, eocd]);
}

// CRC-32 implementation
function crc32(buf) {
    let crc = 0xFFFFFFFF;
    const table = makeCrcTable();
    for (let i = 0; i < buf.length; i++) {
        crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xFF];
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

let _crcTable = null;
function makeCrcTable() {
    if (_crcTable) return _crcTable;
    _crcTable = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        _crcTable[i] = c;
    }
    return _crcTable;
}

module.exports = router;
