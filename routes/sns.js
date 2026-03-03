const express = require('express');
const router = express.Router();
const {
    ListTopicsCommand,
    CreateTopicCommand,
    DeleteTopicCommand,
    PublishCommand,
    SubscribeCommand,
    ListSubscriptionsCommand,
    GetTopicAttributesCommand
} = require('@aws-sdk/client-sns');
const { getSNSClient } = require('../services/awsClient');

const handleError = (err, res) => {
    console.error('SNS Error:', err.name, err.message);
    const statusMap = { 'NoCredentialsError': 401, 'NotFoundException': 404, 'AccessDeniedException': 403 };
    res.status(statusMap[err.name] || 500).json({ success: false, error: err.message, code: err.name });
};

// GET /api/sns/topics
router.get('/topics', async (req, res) => {
    try {
        const client = getSNSClient(req.query.region);
        const topics = [];
        let nextToken;
        do {
            const data = await client.send(new ListTopicsCommand({ NextToken: nextToken }));
            topics.push(...(data.Topics || []));
            nextToken = data.NextToken;
        } while (nextToken);
        res.json({ success: true, count: topics.length, topics });
    } catch (err) { handleError(err, res); }
});

// POST /api/sns/topics — Create topic
router.post('/topics', async (req, res) => {
    try {
        const { name, isFifo = false, region } = req.body;
        if (!name) return res.status(400).json({ success: false, error: 'Topic name is required' });
        const client = getSNSClient(region);
        const attrs = isFifo ? { FifoTopic: 'true' } : {};
        const data = await client.send(new CreateTopicCommand({ Name: name, Attributes: attrs }));
        res.status(201).json({ success: true, message: `SNS topic '${name}' created`, topicArn: data.TopicArn });
    } catch (err) { handleError(err, res); }
});

// DELETE /api/sns/topics — Delete topic
router.delete('/topics', async (req, res) => {
    try {
        const { topicArn } = req.body;
        if (!topicArn) return res.status(400).json({ success: false, error: 'topicArn is required' });
        const client = getSNSClient(req.query.region);
        await client.send(new DeleteTopicCommand({ TopicArn: topicArn }));
        res.json({ success: true, message: 'SNS topic deleted successfully' });
    } catch (err) { handleError(err, res); }
});

// POST /api/sns/publish — Publish message
router.post('/publish', async (req, res) => {
    try {
        const { topicArn, message, subject, phoneNumber } = req.body;
        if (!message) return res.status(400).json({ success: false, error: 'message is required' });
        const client = getSNSClient(req.query.region);
        const params = {
            Message: typeof message === 'string' ? message : JSON.stringify(message),
            Subject: subject
        };
        if (topicArn) params.TopicArn = topicArn;
        if (phoneNumber) params.PhoneNumber = phoneNumber;
        const data = await client.send(new PublishCommand(params));
        res.json({ success: true, messageId: data.MessageId });
    } catch (err) { handleError(err, res); }
});

// POST /api/sns/subscribe — Subscribe to topic
router.post('/subscribe', async (req, res) => {
    try {
        const { topicArn, protocol, endpoint } = req.body;
        if (!topicArn || !protocol || !endpoint) {
            return res.status(400).json({ success: false, error: 'topicArn, protocol, and endpoint are required' });
        }
        const client = getSNSClient(req.query.region);
        const data = await client.send(new SubscribeCommand({ TopicArn: topicArn, Protocol: protocol, Endpoint: endpoint }));
        res.json({ success: true, subscriptionArn: data.SubscriptionArn });
    } catch (err) { handleError(err, res); }
});

// GET /api/sns/subscriptions
router.get('/subscriptions', async (req, res) => {
    try {
        const client = getSNSClient(req.query.region);
        const data = await client.send(new ListSubscriptionsCommand({}));
        res.json({ success: true, count: data.Subscriptions?.length || 0, subscriptions: data.Subscriptions || [] });
    } catch (err) { handleError(err, res); }
});

module.exports = router;
