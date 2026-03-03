import axios from 'axios';

const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';

const api = axios.create({
    baseURL: BASE_URL,
    timeout: 30000,
    headers: { 'Content-Type': 'application/json' }
});

// Response interceptor for unified error handling
api.interceptors.response.use(
    (response) => response,
    (error) => {
        const msg = error.response?.data?.error || error.message || 'Network error';
        return Promise.reject(new Error(msg));
    }
);

// ─── Auth ────────────────────────────────────────────────────────
export const checkAuth = () => api.get('/api/auth/check').then(r => r.data);
export const configureAuth = (creds) => api.post('/api/auth/configure', creds).then(r => r.data);
export const clearAuth = () => api.delete('/api/auth/clear').then(r => r.data);

// ─── NLP Execute ─────────────────────────────────────────────────
export const executePrompt = (prompt, region, context) =>
    api.post('/api/aws/execute', { prompt, region, context }).then(r => r.data);


// ─── S3 ──────────────────────────────────────────────────────────
export const listBuckets = () => api.get('/api/s3/buckets').then(r => r.data);
export const createBucket = (name, region) => api.post('/api/s3/buckets', { name, region }).then(r => r.data);
export const deleteBucket = (name) => api.delete(`/api/s3/buckets/${name}`).then(r => r.data);
export const listObjects = (bucket) => api.get(`/api/s3/buckets/${bucket}/objects`).then(r => r.data);
export const putObject = (bucket, key, body) => api.put(`/api/s3/buckets/${bucket}/objects`, { key, body }).then(r => r.data);
export const deleteObject = (bucket, key) => api.delete(`/api/s3/buckets/${bucket}/objects/${key}`).then(r => r.data);

// ─── Lambda ──────────────────────────────────────────────────────
export const listFunctions = () => api.get('/api/lambda/functions').then(r => r.data);
export const getFunction = (name) => api.get(`/api/lambda/functions/${name}`).then(r => r.data);
export const createFunction = (data) => api.post('/api/lambda/functions', data).then(r => r.data);
export const invokeFunction = (name, payload) => api.post(`/api/lambda/functions/${name}/invoke`, { payload }).then(r => r.data);
export const deleteFunction = (name) => api.delete(`/api/lambda/functions/${name}`).then(r => r.data);

// ─── EC2 ─────────────────────────────────────────────────────────
export const listInstances = () => api.get('/api/ec2/instances').then(r => r.data);
export const startInstance = (id) => api.post(`/api/ec2/instances/${id}/start`).then(r => r.data);
export const stopInstance = (id) => api.post(`/api/ec2/instances/${id}/stop`).then(r => r.data);

// ─── IAM ─────────────────────────────────────────────────────────
export const listUsers = () => api.get('/api/iam/users').then(r => r.data);
export const listRoles = () => api.get('/api/iam/roles').then(r => r.data);
export const listPolicies = () => api.get('/api/iam/policies').then(r => r.data);

// ─── DynamoDB ────────────────────────────────────────────────────
export const listTables = () => api.get('/api/dynamodb/tables').then(r => r.data);
export const createTable = (data) => api.post('/api/dynamodb/tables', data).then(r => r.data);

// ─── SQS ─────────────────────────────────────────────────────────
export const listQueues = () => api.get('/api/sqs/queues').then(r => r.data);
export const createQueue = (name) => api.post('/api/sqs/queues', { name }).then(r => r.data);

// ─── SNS ─────────────────────────────────────────────────────────
export const listTopics = () => api.get('/api/sns/topics').then(r => r.data);

// ─── CloudWatch ──────────────────────────────────────────────────
export const listMetrics = () => api.get('/api/cloudwatch/metrics').then(r => r.data);
export const listAlarms = () => api.get('/api/cloudwatch/alarms').then(r => r.data);

export default api;
