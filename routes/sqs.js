const express = require('express');
const router = express.Router();
const {
    ListQueuesCommand,
    CreateQueueCommand,
    DeleteQueueCommand,
    SendMessageCommand,
    ReceiveMessageCommand,
    DeleteMessageCommand,
    GetQueueAttributesCommand
} = require('@aws-sdk/client-sqs');
const { getSQSClient } = require('../services/awsClient');

const handleError = (err, res) => {
    console.error('SQS Error:', err.name, err.message);
    const statusMap = { 'NoCredentialsError': 401, 'QueueDoesNotExist': 404, 'AccessDeniedException': 403 };
    res.status(statusMap[err.name] || 500).json({ success: false, error: err.message, code: err.name });
};

// GET /api/sqs/queues
router.get('/queues', async (req, res) => {
    try {
        const client = getSQSClient(req.query.region);
        const data = await client.send(new ListQueuesCommand({ MaxResults: 100 }));
        res.json({ success: true, count: data.QueueUrls?.length || 0, queues: data.QueueUrls || [] });
    } catch (err) { handleError(err, res); }
});

// POST /api/sqs/queues — Create queue
router.post('/queues', async (req, res) => {
    try {
        const { name, isFifo = false, region } = req.body;
        if (!name) return res.status(400).json({ success: false, error: 'Queue name is required' });
        const client = getSQSClient(region);
        const queueName = isFifo ? (name.endsWith('.fifo') ? name : `${name}.fifo`) : name;
        const attrs = isFifo ? { FifoQueue: 'true' } : {};
        const data = await client.send(new CreateQueueCommand({ QueueName: queueName, Attributes: attrs }));
        res.status(201).json({ success: true, message: `Queue '${queueName}' created`, queueUrl: data.QueueUrl });
    } catch (err) { handleError(err, res); }
});

// DELETE /api/sqs/queues — Delete queue
router.delete('/queues', async (req, res) => {
    try {
        const { queueUrl } = req.body;
        if (!queueUrl) return res.status(400).json({ success: false, error: 'queueUrl is required' });
        const client = getSQSClient(req.query.region);
        await client.send(new DeleteQueueCommand({ QueueUrl: queueUrl }));
        res.json({ success: true, message: 'Queue deleted successfully' });
    } catch (err) { handleError(err, res); }
});

// POST /api/sqs/queues/send — Send message
router.post('/queues/send', async (req, res) => {
    try {
        const { queueUrl, message, messageGroupId, messageDeduplicationId } = req.body;
        if (!queueUrl || !message) return res.status(400).json({ success: false, error: 'queueUrl and message are required' });
        const client = getSQSClient(req.query.region);
        const params = {
            QueueUrl: queueUrl,
            MessageBody: typeof message === 'string' ? message : JSON.stringify(message)
        };
        if (messageGroupId) params.MessageGroupId = messageGroupId;
        if (messageDeduplicationId) params.MessageDeduplicationId = messageDeduplicationId;
        const data = await client.send(new SendMessageCommand(params));
        res.json({ success: true, messageId: data.MessageId, sequenceNumber: data.SequenceNumber });
    } catch (err) { handleError(err, res); }
});

// POST /api/sqs/queues/receive — Receive messages
router.post('/queues/receive', async (req, res) => {
    try {
        const { queueUrl, maxMessages = 10, waitTimeSeconds = 0 } = req.body;
        if (!queueUrl) return res.status(400).json({ success: false, error: 'queueUrl is required' });
        const client = getSQSClient(req.query.region);
        const data = await client.send(new ReceiveMessageCommand({
            QueueUrl: queueUrl,
            MaxNumberOfMessages: maxMessages,
            WaitTimeSeconds: waitTimeSeconds,
            AttributeNames: ['All']
        }));
        res.json({ success: true, count: data.Messages?.length || 0, messages: data.Messages || [] });
    } catch (err) { handleError(err, res); }
});

module.exports = router;
