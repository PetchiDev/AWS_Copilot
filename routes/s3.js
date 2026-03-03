const express = require('express');
const router = express.Router();
const {
    ListBucketsCommand,
    CreateBucketCommand,
    DeleteBucketCommand,
    ListObjectsV2Command,
    PutObjectCommand,
    GetObjectCommand,
    DeleteObjectCommand,
    HeadBucketCommand,
    GetBucketLocationCommand
} = require('@aws-sdk/client-s3');
const { getS3Client, getS3ClientForBucket, getRegion } = require('../services/awsClient');

const handleError = (err, res, next) => {
    console.error('S3 Error:', err.name, err.message);
    const statusMap = {
        'NoCredentialsError': 401,
        'NoSuchBucket': 404,
        'NoSuchKey': 404,
        'BucketAlreadyExists': 409,
        'BucketAlreadyOwnedByYou': 409,
        'AccessDeniedException': 403,
        'InvalidBucketName': 400
    };
    res.status(statusMap[err.name] || 500).json({
        success: false,
        error: err.message,
        code: err.name
    });
};

// GET /api/s3/buckets — List all buckets
router.get('/buckets', async (req, res) => {
    try {
        const client = getS3Client(req.query.region);
        const data = await client.send(new ListBucketsCommand({}));
        res.json({
            success: true,
            count: data.Buckets?.length || 0,
            buckets: data.Buckets || [],
            owner: data.Owner
        });
    } catch (err) { handleError(err, res); }
});

// POST /api/s3/buckets — Create a bucket
router.post('/buckets', async (req, res) => {
    try {
        const { name, region, acl } = req.body;
        if (!name) return res.status(400).json({ success: false, error: 'Bucket name is required' });

        const r = region || getRegion();
        const client = getS3Client(r);
        const params = { Bucket: name };
        if (r !== 'us-east-1') {
            params.CreateBucketConfiguration = { LocationConstraint: r };
        }
        await client.send(new CreateBucketCommand(params));

        res.status(201).json({
            success: true,
            message: `Bucket '${name}' created successfully`,
            bucket: { name, region: r, arn: `arn:aws:s3:::${name}`, createdAt: new Date().toISOString() }
        });
    } catch (err) { handleError(err, res); }
});

// DELETE /api/s3/buckets/:name — Delete a bucket
router.delete('/buckets/:name', async (req, res) => {
    try {
        const client = await getS3ClientForBucket(req.params.name);
        await client.send(new DeleteBucketCommand({ Bucket: req.params.name }));
        res.json({ success: true, message: `Bucket '${req.params.name}' deleted successfully` });
    } catch (err) { handleError(err, res); }
});

// GET /api/s3/buckets/:name/objects — List objects in a bucket
router.get('/buckets/:name/objects', async (req, res) => {
    try {
        const { prefix, maxKeys = 100 } = req.query;
        const client = await getS3ClientForBucket(req.params.name);
        const data = await client.send(new ListObjectsV2Command({
            Bucket: req.params.name,
            Prefix: prefix,
            MaxKeys: parseInt(maxKeys)
        }));
        res.json({
            success: true,
            bucket: req.params.name,
            count: data.KeyCount || 0,
            objects: data.Contents || [],
            isTruncated: data.IsTruncated,
            nextToken: data.NextContinuationToken
        });
    } catch (err) { handleError(err, res); }
});

// PUT /api/s3/buckets/:name/objects — Put/upload an object
router.put('/buckets/:name/objects', async (req, res) => {
    try {
        const { key, body, contentType } = req.body;
        if (!key) return res.status(400).json({ success: false, error: 'Object key is required' });
        const client = await getS3ClientForBucket(req.params.name);
        await client.send(new PutObjectCommand({
            Bucket: req.params.name,
            Key: key,
            Body: body || '',
            ContentType: contentType || 'text/plain'
        }));
        res.json({
            success: true,
            message: `Object '${key}' uploaded to '${req.params.name}'`,
            object: { bucket: req.params.name, key, contentType }
        });
    } catch (err) { handleError(err, res); }
});

// DELETE /api/s3/buckets/:name/objects?key=path/to/key — Delete an object
router.delete('/buckets/:name/objects', async (req, res) => {
    try {
        const objectKey = req.query.key;
        if (!objectKey) return res.status(400).json({ success: false, error: 'key query param is required' });
        const client = await getS3ClientForBucket(req.params.name);
        await client.send(new DeleteObjectCommand({
            Bucket: req.params.name,
            Key: objectKey
        }));
        res.json({
            success: true,
            message: `Object '${objectKey}' deleted from '${req.params.name}'`
        });
    } catch (err) { handleError(err, res); }
});

module.exports = router;
