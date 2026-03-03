const express = require('express');
const router = express.Router();
const {
    DescribeInstancesCommand,
    StartInstancesCommand,
    StopInstancesCommand,
    DescribeInstanceStatusCommand,
    DescribeRegionsCommand
} = require('@aws-sdk/client-ec2');
const { getEC2Client } = require('../services/awsClient');

const handleError = (err, res) => {
    console.error('EC2 Error:', err.name, err.message);
    const statusMap = { 'NoCredentialsError': 401, 'AccessDeniedException': 403 };
    res.status(statusMap[err.name] || 500).json({ success: false, error: err.message, code: err.name });
};

// GET /api/ec2/instances — List instances
router.get('/instances', async (req, res) => {
    try {
        const client = getEC2Client(req.query.region);
        const data = await client.send(new DescribeInstancesCommand({}));
        const instances = [];
        for (const reservation of (data.Reservations || [])) {
            for (const instance of (reservation.Instances || [])) {
                instances.push({
                    instanceId: instance.InstanceId,
                    instanceType: instance.InstanceType,
                    state: instance.State?.Name,
                    publicIpAddress: instance.PublicIpAddress,
                    privateIpAddress: instance.PrivateIpAddress,
                    launchTime: instance.LaunchTime,
                    name: instance.Tags?.find(t => t.Key === 'Name')?.Value || 'Unnamed',
                    platform: instance.Platform || 'Linux',
                    availabilityZone: instance.Placement?.AvailabilityZone
                });
            }
        }
        res.json({ success: true, count: instances.length, instances });
    } catch (err) { handleError(err, res); }
});

// GET /api/ec2/instances/:id — Describe specific instance
router.get('/instances/:id', async (req, res) => {
    try {
        const client = getEC2Client(req.query.region);
        const data = await client.send(new DescribeInstancesCommand({
            InstanceIds: [req.params.id]
        }));
        const instance = data.Reservations?.[0]?.Instances?.[0];
        if (!instance) return res.status(404).json({ success: false, error: 'Instance not found' });
        res.json({ success: true, instance });
    } catch (err) { handleError(err, res); }
});

// POST /api/ec2/instances/:id/start — Start instance
router.post('/instances/:id/start', async (req, res) => {
    try {
        const client = getEC2Client(req.query.region);
        const data = await client.send(new StartInstancesCommand({ InstanceIds: [req.params.id] }));
        res.json({
            success: true,
            message: `Instance '${req.params.id}' start initiated`,
            stateChange: data.StartingInstances?.[0]
        });
    } catch (err) { handleError(err, res); }
});

// POST /api/ec2/instances/:id/stop — Stop instance
router.post('/instances/:id/stop', async (req, res) => {
    try {
        const client = getEC2Client(req.query.region);
        const data = await client.send(new StopInstancesCommand({ InstanceIds: [req.params.id] }));
        res.json({
            success: true,
            message: `Instance '${req.params.id}' stop initiated`,
            stateChange: data.StoppingInstances?.[0]
        });
    } catch (err) { handleError(err, res); }
});

// GET /api/ec2/regions — List available regions
router.get('/regions', async (req, res) => {
    try {
        const client = getEC2Client('us-east-1');
        const data = await client.send(new DescribeRegionsCommand({ AllRegions: false }));
        res.json({ success: true, regions: data.Regions || [] });
    } catch (err) { handleError(err, res); }
});

module.exports = router;
