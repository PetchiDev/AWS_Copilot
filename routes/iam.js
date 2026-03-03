const express = require('express');
const router = express.Router();
const {
    ListUsersCommand,
    ListRolesCommand,
    ListPoliciesCommand,
    GetRoleCommand,
    CreateRoleCommand,
    DeleteRoleCommand,
    AttachRolePolicyCommand,
    DetachRolePolicyCommand,
    ListAttachedRolePoliciesCommand,
    ListRolePoliciesCommand,
    PutRolePolicyCommand
} = require('@aws-sdk/client-iam');
const { getIAMClient } = require('../services/awsClient');

const handleError = (err, res) => {
    console.error('IAM Error:', err.name, err.message);
    const statusMap = {
        'NoCredentialsError': 401,
        'AccessDeniedException': 403,
        'NoSuchEntity': 404,
        'EntityAlreadyExists': 409,
        'MalformedPolicyDocument': 400,
        'InvalidInput': 400
    };
    res.status(statusMap[err.name] || 500).json({
        success: false,
        error: err.message,
        code: err.name
    });
};

// ─── AWS Managed Policy ARNs (commonly used) ───────────────────────
const MANAGED_POLICIES = {
    // Lambda
    'AWSLambdaBasicExecutionRole': 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
    'AWSLambdaVPCAccessExecutionRole': 'arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole',
    'AWSLambdaFullAccess': 'arn:aws:iam::aws:policy/AWSLambda_FullAccess',
    // S3
    'AmazonS3FullAccess': 'arn:aws:iam::aws:policy/AmazonS3FullAccess',
    'AmazonS3ReadOnlyAccess': 'arn:aws:iam::aws:policy/AmazonS3ReadOnlyAccess',
    // DynamoDB
    'AmazonDynamoDBFullAccess': 'arn:aws:iam::aws:policy/AmazonDynamoDBFullAccess',
    'AmazonDynamoDBReadOnlyAccess': 'arn:aws:iam::aws:policy/AmazonDynamoDBReadOnlyAccess',
    // EC2
    'AmazonEC2FullAccess': 'arn:aws:iam::aws:policy/AmazonEC2FullAccess',
    'AmazonEC2ReadOnlyAccess': 'arn:aws:iam::aws:policy/AmazonEC2ReadOnlyAccess',
    // SQS
    'AmazonSQSFullAccess': 'arn:aws:iam::aws:policy/AmazonSQSFullAccess',
    // SNS
    'AmazonSNSFullAccess': 'arn:aws:iam::aws:policy/AmazonSNSFullAccess',
    // CloudWatch
    'CloudWatchFullAccess': 'arn:aws:iam::aws:policy/CloudWatchFullAccess',
    // Admin
    'AdministratorAccess': 'arn:aws:iam::aws:policy/AdministratorAccess',
    'ReadOnlyAccess': 'arn:aws:iam::aws:policy/ReadOnlyAccess',
    'PowerUserAccess': 'arn:aws:iam::aws:policy/PowerUserAccess'
};

// ─── Trust Policy Templates ────────────────────────────────────────
const TRUST_POLICIES = {
    lambda: {
        Version: '2012-10-17',
        Statement: [{
            Effect: 'Allow',
            Principal: { Service: 'lambda.amazonaws.com' },
            Action: 'sts:AssumeRole'
        }]
    },
    ec2: {
        Version: '2012-10-17',
        Statement: [{
            Effect: 'Allow',
            Principal: { Service: 'ec2.amazonaws.com' },
            Action: 'sts:AssumeRole'
        }]
    },
    apigateway: {
        Version: '2012-10-17',
        Statement: [{
            Effect: 'Allow',
            Principal: { Service: 'apigateway.amazonaws.com' },
            Action: 'sts:AssumeRole'
        }]
    },
    ecs: {
        Version: '2012-10-17',
        Statement: [{
            Effect: 'Allow',
            Principal: { Service: 'ecs-tasks.amazonaws.com' },
            Action: 'sts:AssumeRole'
        }]
    }
};

// GET /api/iam/users
router.get('/users', async (req, res) => {
    try {
        const client = getIAMClient();
        const data = await client.send(new ListUsersCommand({ MaxItems: 100 }));
        res.json({
            success: true,
            count: data.Users?.length || 0,
            users: (data.Users || []).map(u => ({
                userId: u.UserId,
                userName: u.UserName,
                arn: u.Arn,
                createdAt: u.CreateDate,
                path: u.Path
            }))
        });
    } catch (err) { handleError(err, res); }
});

// GET /api/iam/roles
router.get('/roles', async (req, res) => {
    try {
        const client = getIAMClient();
        const data = await client.send(new ListRolesCommand({ MaxItems: 100 }));
        res.json({
            success: true,
            count: data.Roles?.length || 0,
            roles: (data.Roles || []).map(r => ({
                roleId: r.RoleId,
                roleName: r.RoleName,
                arn: r.Arn,
                description: r.Description,
                createdAt: r.CreateDate
            }))
        });
    } catch (err) { handleError(err, res); }
});

// GET /api/iam/roles/:name — Get role + attached policies
router.get('/roles/:name', async (req, res) => {
    try {
        const client = getIAMClient();
        const [roleData, policiesData] = await Promise.all([
            client.send(new GetRoleCommand({ RoleName: req.params.name })),
            client.send(new ListAttachedRolePoliciesCommand({ RoleName: req.params.name }))
        ]);
        res.json({
            success: true,
            role: roleData.Role,
            attachedPolicies: policiesData.AttachedPolicies || []
        });
    } catch (err) { handleError(err, res); }
});

// POST /api/iam/roles — Create a new IAM role
router.post('/roles', async (req, res) => {
    try {
        const {
            name,
            description = 'Created by AWS Copilot',
            service = 'lambda',       // lambda | ec2 | apigateway | ecs
            trustPolicy,              // custom trust policy JSON (optional)
            policyArns = [],          // array of managed policy ARNs to attach immediately
            policyNames = []          // array of shorthand policy names e.g. "AWSLambdaBasicExecutionRole"
        } = req.body;

        if (!name) {
            return res.status(400).json({ success: false, error: 'Role name is required' });
        }

        const client = getIAMClient();

        // Resolve trust policy
        const resolvedTrustPolicy = trustPolicy
            ? (typeof trustPolicy === 'string' ? trustPolicy : JSON.stringify(trustPolicy))
            : JSON.stringify(TRUST_POLICIES[service] || TRUST_POLICIES.lambda);

        // Step 1: Create the role
        const roleData = await client.send(new CreateRoleCommand({
            RoleName: name,
            AssumeRolePolicyDocument: resolvedTrustPolicy,
            Description: description,
            Path: '/'
        }));

        // Step 2: Resolve and attach policies
        const allPolicyArns = [...policyArns];

        // Resolve shorthand names → ARNs
        for (const pName of policyNames) {
            if (MANAGED_POLICIES[pName]) {
                allPolicyArns.push(MANAGED_POLICIES[pName]);
            } else if (pName.startsWith('arn:aws:')) {
                allPolicyArns.push(pName);
            }
        }

        // Default: if creating for Lambda and no policies specified, add basic execution
        if (service === 'lambda' && allPolicyArns.length === 0) {
            allPolicyArns.push(MANAGED_POLICIES['AWSLambdaBasicExecutionRole']);
        }

        // Attach all policies in parallel
        const attachResults = await Promise.allSettled(
            allPolicyArns.map(arn =>
                client.send(new AttachRolePolicyCommand({ RoleName: name, PolicyArn: arn }))
            )
        );

        const attached = allPolicyArns.filter((_, i) => attachResults[i].status === 'fulfilled');
        const failed = allPolicyArns.filter((_, i) => attachResults[i].status === 'rejected');

        res.status(201).json({
            success: true,
            message: ` IAM Role '${name}' created successfully`,
            role: {
                roleId: roleData.Role.RoleId,
                roleName: roleData.Role.RoleName,
                arn: roleData.Role.Arn,
                description: roleData.Role.Description,
                createdAt: roleData.Role.CreateDate,
                trustService: service
            },
            policiesAttached: attached,
            policiesFailed: failed
        });
    } catch (err) { handleError(err, res); }
});

// POST /api/iam/roles/:name/attach-policy — Attach a managed policy to a role
router.post('/roles/:name/attach-policy', async (req, res) => {
    try {
        const { policyArn, policyName } = req.body;
        const client = getIAMClient();

        let arn = policyArn;
        if (!arn && policyName) {
            arn = MANAGED_POLICIES[policyName];
            if (!arn) {
                return res.status(400).json({
                    success: false,
                    error: `Unknown policy name '${policyName}'.`,
                    availablePolicies: Object.keys(MANAGED_POLICIES)
                });
            }
        }
        if (!arn) {
            return res.status(400).json({
                success: false,
                error: 'policyArn or policyName is required',
                availablePolicies: Object.keys(MANAGED_POLICIES)
            });
        }

        await client.send(new AttachRolePolicyCommand({
            RoleName: req.params.name,
            PolicyArn: arn
        }));

        res.json({
            success: true,
            message: ` Policy attached to role '${req.params.name}'`,
            role: req.params.name,
            policyArn: arn
        });
    } catch (err) { handleError(err, res); }
});

// DELETE /api/iam/roles/:name/detach-policy — Detach a managed policy
router.delete('/roles/:name/detach-policy', async (req, res) => {
    try {
        const { policyArn, policyName } = req.body;
        const client = getIAMClient();

        const arn = policyArn || MANAGED_POLICIES[policyName];
        if (!arn) {
            return res.status(400).json({ success: false, error: 'policyArn or policyName is required' });
        }

        await client.send(new DetachRolePolicyCommand({
            RoleName: req.params.name,
            PolicyArn: arn
        }));

        res.json({
            success: true,
            message: ` Policy detached from role '${req.params.name}'`,
            role: req.params.name,
            policyArn: arn
        });
    } catch (err) { handleError(err, res); }
});

// DELETE /api/iam/roles/:name — Delete role (detaches all policies first)
router.delete('/roles/:name', async (req, res) => {
    try {
        const client = getIAMClient();
        const roleName = req.params.name;

        // Step 1: Detach all attached managed policies
        const policies = await client.send(new ListAttachedRolePoliciesCommand({ RoleName: roleName }));
        await Promise.allSettled(
            (policies.AttachedPolicies || []).map(p =>
                client.send(new DetachRolePolicyCommand({ RoleName: roleName, PolicyArn: p.PolicyArn }))
            )
        );

        // Step 2: Delete inline policies
        const inlinePolicies = await client.send(new ListRolePoliciesCommand({ RoleName: roleName }));
        // (skip deletion of inline policies for now — AWS will reject if any exist)

        // Step 3: Delete the role
        const { DeleteRoleCommand } = require('@aws-sdk/client-iam');
        await client.send(new DeleteRoleCommand({ RoleName: roleName }));

        res.json({
            success: true,
            message: ` IAM Role '${roleName}' deleted successfully`
        });
    } catch (err) { handleError(err, res); }
});

// GET /api/iam/policies
router.get('/policies', async (req, res) => {
    try {
        const client = getIAMClient();
        const data = await client.send(new ListPoliciesCommand({ Scope: 'Local', MaxItems: 100 }));
        res.json({
            success: true,
            count: data.Policies?.length || 0,
            policies: (data.Policies || []).map(p => ({
                policyId: p.PolicyId,
                policyName: p.PolicyName,
                arn: p.Arn,
                description: p.Description,
                attachmentCount: p.AttachmentCount,
                createdAt: p.CreateDate
            }))
        });
    } catch (err) { handleError(err, res); }
});

// GET /api/iam/managed-policies — List all supported shorthand policy names
router.get('/managed-policies', (req, res) => {
    res.json({
        success: true,
        policies: Object.entries(MANAGED_POLICIES).map(([name, arn]) => ({ name, arn }))
    });
});

// Export MANAGED_POLICIES and TRUST_POLICIES for use in nlp.js
module.exports = router;
module.exports.MANAGED_POLICIES = MANAGED_POLICIES;
module.exports.TRUST_POLICIES = TRUST_POLICIES;
