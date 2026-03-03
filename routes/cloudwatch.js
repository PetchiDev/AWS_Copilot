const express = require('express');
const router = express.Router();
const {
    ListMetricsCommand,
    GetMetricDataCommand,
    DescribeAlarmsCommand,
    PutMetricAlarmCommand,
    DeleteAlarmsCommand
} = require('@aws-sdk/client-cloudwatch');
const { getCloudWatchClient } = require('../services/awsClient');

const handleError = (err, res) => {
    console.error('CloudWatch Error:', err.name, err.message);
    const statusMap = { 'NoCredentialsError': 401, 'AccessDeniedException': 403 };
    res.status(statusMap[err.name] || 500).json({ success: false, error: err.message, code: err.name });
};

// GET /api/cloudwatch/metrics
router.get('/metrics', async (req, res) => {
    try {
        const { namespace, metricName } = req.query;
        const client = getCloudWatchClient(req.query.region);
        const params = {};
        if (namespace) params.Namespace = namespace;
        if (metricName) params.MetricName = metricName;
        const data = await client.send(new ListMetricsCommand(params));
        res.json({ success: true, count: data.Metrics?.length || 0, metrics: data.Metrics || [] });
    } catch (err) { handleError(err, res); }
});

// POST /api/cloudwatch/metrics/data — Get metric statistics
router.post('/metrics/data', async (req, res) => {
    try {
        const { queries, startTime, endTime } = req.body;
        if (!queries || !queries.length) {
            return res.status(400).json({ success: false, error: 'queries array is required' });
        }
        const client = getCloudWatchClient(req.query.region);
        const data = await client.send(new GetMetricDataCommand({
            MetricDataQueries: queries,
            StartTime: startTime ? new Date(startTime) : new Date(Date.now() - 3600000),
            EndTime: endTime ? new Date(endTime) : new Date()
        }));
        res.json({ success: true, results: data.MetricDataResults || [], messages: data.Messages });
    } catch (err) { handleError(err, res); }
});

// GET /api/cloudwatch/alarms
router.get('/alarms', async (req, res) => {
    try {
        const { state } = req.query;
        const client = getCloudWatchClient(req.query.region);
        const params = {};
        if (state) params.StateValue = state.toUpperCase();
        const data = await client.send(new DescribeAlarmsCommand(params));
        const alarms = [
            ...(data.MetricAlarms || []),
            ...(data.CompositeAlarms || [])
        ];
        res.json({ success: true, count: alarms.length, alarms });
    } catch (err) { handleError(err, res); }
});

// DELETE /api/cloudwatch/alarms — Delete alarms
router.delete('/alarms', async (req, res) => {
    try {
        const { alarmNames } = req.body;
        if (!alarmNames || !alarmNames.length) {
            return res.status(400).json({ success: false, error: 'alarmNames array is required' });
        }
        const client = getCloudWatchClient(req.query.region);
        await client.send(new DeleteAlarmsCommand({ AlarmNames: alarmNames }));
        res.json({ success: true, message: `${alarmNames.length} alarm(s) deleted` });
    } catch (err) { handleError(err, res); }
});

module.exports = router;
