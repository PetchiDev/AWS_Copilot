const express = require('express');
const router = express.Router();
const {
    ListFunctionsCommand,
    GetFunctionCommand,
    CreateFunctionCommand,
    DeleteFunctionCommand,
    InvokeCommand,
    UpdateFunctionCodeCommand
} = require('@aws-sdk/client-lambda');
const { getLambdaClient, getRegion } = require('../services/awsClient');

const handleError = (err, res) => {
    console.error('Lambda Error:', err.name, err.message);
    const statusMap = {
        'NoCredentialsError': 401,
        'ResourceNotFoundException': 404,
        'ResourceConflictException': 409,
        'AccessDeniedException': 403,
        'InvalidParameterValueException': 400
    };
    res.status(statusMap[err.name] || 500).json({ success: false, error: err.message, code: err.name });
};

// GET /api/lambda/functions — List functions
router.get('/functions', async (req, res) => {
    try {
        const client = getLambdaClient(req.query.region);
        const functions = [];
        let marker;
        do {
            const data = await client.send(new ListFunctionsCommand({ Marker: marker, MaxItems: 50 }));
            functions.push(...(data.Functions || []));
            marker = data.NextMarker;
        } while (marker);
        res.json({ success: true, count: functions.length, functions });
    } catch (err) { handleError(err, res); }
});

// GET /api/lambda/functions/:name — Get function details
router.get('/functions/:name', async (req, res) => {
    try {
        const client = getLambdaClient(req.query.region);
        const data = await client.send(new GetFunctionCommand({ FunctionName: req.params.name }));
        res.json({ success: true, function: data.Configuration, code: data.Code, tags: data.Tags });
    } catch (err) { handleError(err, res); }
});

// POST /api/lambda/functions — Create function
router.post('/functions', async (req, res) => {
    try {
        const { name, runtime, role, handler, description, code, environment, timeout, memorySize, region } = req.body;
        if (!name || !runtime || !role) {
            return res.status(400).json({ success: false, error: 'name, runtime, and role are required' });
        }
        const client = getLambdaClient(region || getRegion());

        // Default placeholder code if none provided
        const zipCode = code || Buffer.from(
            `import json\ndef handler(event, context):\n    return {'statusCode': 200, 'body': json.dumps('Hello from ${name}!')}`
        ).toString('base64');

        const data = await client.send(new CreateFunctionCommand({
            FunctionName: name,
            Runtime: runtime || 'python3.12',
            Role: role,
            Handler: handler || 'lambda_function.handler',
            Description: description || `Created by AWS Copilot`,
            Code: { ZipFile: Buffer.from(zipCode, 'base64') },
            Environment: environment ? { Variables: environment } : undefined,
            Timeout: timeout || 30,
            MemorySize: memorySize || 128
        }));
        res.status(201).json({
            success: true,
            message: `Lambda function '${name}' created successfully`,
            function: data
        });
    } catch (err) { handleError(err, res); }
});

// POST /api/lambda/functions/:name/invoke — Invoke function
router.post('/functions/:name/invoke', async (req, res) => {
    try {
        const { payload, invocationType = 'RequestResponse' } = req.body;
        const client = getLambdaClient(req.query.region);
        const data = await client.send(new InvokeCommand({
            FunctionName: req.params.name,
            InvocationType: invocationType,
            Payload: payload ? JSON.stringify(payload) : JSON.stringify({})
        }));
        const responsePayload = data.Payload
            ? JSON.parse(Buffer.from(data.Payload).toString())
            : null;
        res.json({
            success: true,
            functionName: req.params.name,
            statusCode: data.StatusCode,
            executedVersion: data.ExecutedVersion,
            functionError: data.FunctionError,
            payload: responsePayload
        });
    } catch (err) { handleError(err, res); }
});

// DELETE /api/lambda/functions/:name — Delete function
router.delete('/functions/:name', async (req, res) => {
    try {
        const client = getLambdaClient(req.query.region);
        await client.send(new DeleteFunctionCommand({ FunctionName: req.params.name }));
        res.json({ success: true, message: `Lambda function '${req.params.name}' deleted successfully` });
    } catch (err) { handleError(err, res); }
});

module.exports = router;
