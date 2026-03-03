# AWS Copilot UI

A natural-language-driven AWS management interface built with **React** (frontend) and **Node.js/Express + AWS SDK v3** (backend).

## 🧠 Architecture

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the full breakdown (intent parsing → missing-param clarification → AWS execution → optional Gemini analysis).

## 🚀 Quick Start

### 1. Start Backend Server
```bash
# From project root: c:\Users\petchiappan.p\AWS_Demo
npm run dev
```
Backend runs at: **http://localhost:5000**

### 2. Start Frontend
```bash
cd frontend
npm run dev
```
Frontend runs at: **http://localhost:5173**

---

## 📋 Available APIs

| Service     | Endpoints |
|-------------|-----------|
| 🔐 Auth     | `GET /api/auth/check` · `POST /api/auth/configure` · `DELETE /api/auth/clear` |
| 🪣 S3       | `/api/s3/buckets` · `/api/s3/buckets/:name/objects` |
| ⚡ Lambda   | `/api/lambda/functions` · `/api/lambda/functions/:name/invoke` |
| 🖥️ EC2      | `/api/ec2/instances` · `/api/ec2/instances/:id/start` |
| 🛡️ IAM      | `/api/iam/users` · `/api/iam/roles` · `/api/iam/policies` |
| 🗄️ DynamoDB | `/api/dynamodb/tables` · `/api/dynamodb/tables/:name/items` |
| 📨 SQS      | `/api/sqs/queues` · `/api/sqs/queues/send` |
| 🔔 SNS      | `/api/sns/topics` · `/api/sns/publish` |
| 📊 CloudWatch| `/api/cloudwatch/metrics` · `/api/cloudwatch/alarms` |
| 🤖 **NLP** | `POST /api/aws/execute` ← **Main endpoint** |

## 💬 Example NLP Prompts
- `List all S3 buckets`
- `Create an S3 bucket named test-bucket in ap-south-1`
- `List Lambda functions`
- `List EC2 instances`
- `Show CloudWatch alarms`

## 🔐 AWS Credentials
Enter your AWS credentials in the login modal. They are stored **in memory only** and never persisted to disk.
