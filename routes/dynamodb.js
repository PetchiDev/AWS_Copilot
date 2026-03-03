const express = require('express');
const router = express.Router();
const {
    ListTablesCommand,
    CreateTableCommand,
    DescribeTableCommand,
    DeleteTableCommand,
    PutItemCommand,
    GetItemCommand,
    DeleteItemCommand,
    ScanCommand,
    QueryCommand
} = require('@aws-sdk/client-dynamodb');
const { getDynamoDBClient } = require('../services/awsClient');

const handleError = (err, res) => {
    console.error('DynamoDB Error:', err.name, err.message);
    const statusMap = {
        'NoCredentialsError': 401,
        'ResourceNotFoundException': 404,
        'ResourceInUseException': 409,
        'AccessDeniedException': 403,
        'ValidationException': 400
    };
    res.status(statusMap[err.name] || 500).json({ success: false, error: err.message, code: err.name });
};

// GET /api/dynamodb/tables
router.get('/tables', async (req, res) => {
    try {
        const client = getDynamoDBClient(req.query.region);
        const tables = [];
        let lastKey;
        do {
            const data = await client.send(new ListTablesCommand({ ExclusiveStartTableName: lastKey, Limit: 100 }));
            tables.push(...(data.TableNames || []));
            lastKey = data.LastEvaluatedTableName;
        } while (lastKey);
        res.json({ success: true, count: tables.length, tables });
    } catch (err) { handleError(err, res); }
});

// GET /api/dynamodb/tables/:name
router.get('/tables/:name', async (req, res) => {
    try {
        const client = getDynamoDBClient(req.query.region);
        const data = await client.send(new DescribeTableCommand({ TableName: req.params.name }));
        res.json({ success: true, table: data.Table });
    } catch (err) { handleError(err, res); }
});

// POST /api/dynamodb/tables — Create table
router.post('/tables', async (req, res) => {
    try {
        const { name, partitionKey = 'id', partitionKeyType = 'S', billingMode = 'PAY_PER_REQUEST', region } = req.body;
        if (!name) return res.status(400).json({ success: false, error: 'Table name is required' });
        const client = getDynamoDBClient(region);
        const data = await client.send(new CreateTableCommand({
            TableName: name,
            AttributeDefinitions: [{ AttributeName: partitionKey, AttributeType: partitionKeyType }],
            KeySchema: [{ AttributeName: partitionKey, KeyType: 'HASH' }],
            BillingMode: billingMode
        }));
        res.status(201).json({
            success: true,
            message: `DynamoDB table '${name}' created successfully`,
            table: data.TableDescription
        });
    } catch (err) { handleError(err, res); }
});

// DELETE /api/dynamodb/tables/:name
router.delete('/tables/:name', async (req, res) => {
    try {
        const client = getDynamoDBClient(req.query.region);
        await client.send(new DeleteTableCommand({ TableName: req.params.name }));
        res.json({ success: true, message: `DynamoDB table '${req.params.name}' deleted` });
    } catch (err) { handleError(err, res); }
});

// POST /api/dynamodb/tables/:name/items — Put item
router.post('/tables/:name/items', async (req, res) => {
    try {
        const { item } = req.body;
        if (!item) return res.status(400).json({ success: false, error: 'item object is required' });
        const client = getDynamoDBClient(req.query.region);
        // Convert plain JS object to DynamoDB format
        const dynamoItem = {};
        for (const [k, v] of Object.entries(item)) {
            if (typeof v === 'string') dynamoItem[k] = { S: v };
            else if (typeof v === 'number') dynamoItem[k] = { N: String(v) };
            else if (typeof v === 'boolean') dynamoItem[k] = { BOOL: v };
            else dynamoItem[k] = { S: JSON.stringify(v) };
        }
        await client.send(new PutItemCommand({ TableName: req.params.name, Item: dynamoItem }));
        res.json({ success: true, message: 'Item added successfully', item });
    } catch (err) { handleError(err, res); }
});

// GET /api/dynamodb/tables/:name/items — Scan items
router.get('/tables/:name/items', async (req, res) => {
    try {
        const { limit = 50 } = req.query;
        const client = getDynamoDBClient(req.query.region);
        const data = await client.send(new ScanCommand({ TableName: req.params.name, Limit: parseInt(limit) }));
        res.json({ success: true, count: data.Count, items: data.Items || [], scannedCount: data.ScannedCount });
    } catch (err) { handleError(err, res); }
});

module.exports = router;
