import React, { useState } from 'react';
import {
    CheckCircle, XCircle, ChevronDown, ChevronUp,
    ExternalLink, Copy, HardDrive, Zap, Server,
    Shield, Database, MessageSquare, Bell, BarChart2, Clock
} from 'lucide-react';
import './ResultCard.css';

const SERVICE_ICONS = {
    S3: HardDrive, Lambda: Zap, EC2: Server, IAM: Shield,
    DynamoDB: Database, SQS: MessageSquare, SNS: Bell, CloudWatch: BarChart2
};

const AWS_CONSOLE_URLS = {
    S3: 'https://s3.console.aws.amazon.com/s3/buckets',
    Lambda: 'https://console.aws.amazon.com/lambda/home',
    EC2: 'https://console.aws.amazon.com/ec2/home',
    IAM: 'https://console.aws.amazon.com/iamv2/home',
    DynamoDB: 'https://console.aws.amazon.com/dynamodbv2/home',
    SQS: 'https://console.aws.amazon.com/sqs/v3/home',
    SNS: 'https://console.aws.amazon.com/sns/v3/home',
    CloudWatch: 'https://console.aws.amazon.com/cloudwatch/home'
};

export default function ResultCard({ data, intent, success, processingTimeMs, suggestions }) {
    const [showRaw, setShowRaw] = useState(false);
    const [copied, setCopied] = useState(false);

    const Service = intent?.service;
    const Icon = SERVICE_ICONS[Service] || CheckCircle;
    const consoleUrl = AWS_CONSOLE_URLS[Service];

    const copyRaw = () => {
        navigator.clipboard.writeText(JSON.stringify(data, null, 2));
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const renderContent = () => {
        if (!data) return null;

        // S3 Buckets
        if (data.buckets !== undefined) {
            return (
                <div className="result-table-wrap">
                    <p className="result-count">{data.count} bucket{data.count !== 1 ? 's' : ''}</p>
                    {data.buckets.length > 0 ? (
                        <table className="result-table">
                            <thead><tr><th>Bucket Name</th><th>Created</th></tr></thead>
                            <tbody>
                                {data.buckets.map((b, i) => (
                                    <tr key={i}>
                                        <td><span className="mono">{b.Name}</span></td>
                                        <td>{b.CreationDate ? new Date(b.CreationDate).toLocaleDateString() : '—'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    ) : <p className="result-empty">No buckets found.</p>}
                </div>
            );
        }

        // S3 Objects
        if (data.objects !== undefined) {
            return (
                <div className="result-table-wrap">
                    <p className="result-count">{data.count} object{data.count !== 1 ? 's' : ''} in <span className="mono">{data.bucket}</span></p>
                    {data.objects.length > 0 ? (
                        <table className="result-table">
                            <thead><tr><th>Key</th><th>Size</th><th>Modified</th></tr></thead>
                            <tbody>
                                {data.objects.map((o, i) => (
                                    <tr key={i}>
                                        <td><span className="mono">{o.Key}</span></td>
                                        <td>{o.Size ? `${(o.Size / 1024).toFixed(1)} KB` : '—'}</td>
                                        <td>{o.LastModified ? new Date(o.LastModified).toLocaleDateString() : '—'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    ) : <p className="result-empty">No objects found.</p>}
                </div>
            );
        }

        // Lambda functions
        if (data.functions !== undefined) {
            return (
                <div className="result-table-wrap">
                    <p className="result-count">{data.count} function{data.count !== 1 ? 's' : ''}</p>
                    {data.functions.length > 0 ? (
                        <table className="result-table">
                            <thead><tr><th>Name</th><th>Runtime</th><th>Memory</th><th>Timeout</th></tr></thead>
                            <tbody>
                                {data.functions.map((f, i) => (
                                    <tr key={i}>
                                        <td><span className="mono">{f.FunctionName}</span></td>
                                        <td><span className="badge badge-blue">{f.Runtime}</span></td>
                                        <td>{f.MemorySize} MB</td>
                                        <td>{f.Timeout}s</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    ) : <p className="result-empty">No functions found.</p>}
                </div>
            );
        }

        // EC2 Instances
        if (data.instances !== undefined) {
            return (
                <div className="result-table-wrap">
                    <p className="result-count">{data.count} instance{data.count !== 1 ? 's' : ''}</p>
                    {data.instances.length > 0 ? (
                        <table className="result-table">
                            <thead><tr><th>Name</th><th>ID</th><th>Type</th><th>State</th><th>IP</th></tr></thead>
                            <tbody>
                                {data.instances.map((i, idx) => (
                                    <tr key={idx}>
                                        <td>{i.name}</td>
                                        <td><span className="mono">{i.id}</span></td>
                                        <td>{i.type}</td>
                                        <td><span className={`badge ${i.state === 'running' ? 'badge-green' : i.state === 'stopped' ? 'badge-red' : 'badge-amber'}`}>{i.state}</span></td>
                                        <td><span className="mono">{i.publicIp || i.privateIp || '—'}</span></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    ) : <p className="result-empty">No instances found.</p>}
                </div>
            );
        }

        // IAM users
        if (data.users !== undefined) {
            return (
                <div className="result-table-wrap">
                    <p className="result-count">{data.count} user{data.count !== 1 ? 's' : ''}</p>
                    {data.users.length > 0 ? (
                        <table className="result-table">
                            <thead><tr><th>Username</th><th>UserID</th><th>Created</th></tr></thead>
                            <tbody>
                                {data.users.map((u, i) => (
                                    <tr key={i}>
                                        <td><span className="mono">{u.UserName || u.userName}</span></td>
                                        <td><span className="mono">{u.UserId || u.userId}</span></td>
                                        <td>{(u.CreateDate || u.createdAt) ? new Date(u.CreateDate || u.createdAt).toLocaleDateString() : '—'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    ) : <p className="result-empty">No users found.</p>}
                </div>
            );
        }

        // DynamoDB tables
        if (data.tables !== undefined) {
            return (
                <div className="result-table-wrap">
                    <p className="result-count">{data.count} table{data.count !== 1 ? 's' : ''}</p>
                    {data.tables.length > 0 ? (
                        <div className="result-chips">
                            {data.tables.map((t, i) => (
                                <span key={i} className="result-chip"><Database size={10} /> {t}</span>
                            ))}
                        </div>
                    ) : <p className="result-empty">No tables found.</p>}
                </div>
            );
        }

        // SQS queues
        if (data.queues !== undefined) {
            return (
                <div className="result-table-wrap">
                    <p className="result-count">{data.count} queue{data.count !== 1 ? 's' : ''}</p>
                    {data.queues.length > 0 ? (
                        <div className="result-list">
                            {data.queues.map((q, i) => <div key={i} className="mono result-list-item">{q}</div>)}
                        </div>
                    ) : <p className="result-empty">No queues found.</p>}
                </div>
            );
        }

        // SNS Topics
        if (data.topics !== undefined) {
            return (
                <div className="result-table-wrap">
                    <p className="result-count">{data.count} topic{data.count !== 1 ? 's' : ''}</p>
                    {data.topics.length > 0 ? (
                        <div className="result-list">
                            {data.topics.map((t, i) => <div key={i} className="mono result-list-item">{t.TopicArn}</div>)}
                        </div>
                    ) : <p className="result-empty">No topics found.</p>}
                </div>
            );
        }

        // CloudWatch alarms
        if (data.alarms !== undefined) {
            return (
                <div className="result-table-wrap">
                    <p className="result-count">{data.count} alarm{data.count !== 1 ? 's' : ''}</p>
                    {data.alarms.length > 0 ? (
                        <table className="result-table">
                            <thead><tr><th>Name</th><th>State</th><th>Metric</th></tr></thead>
                            <tbody>
                                {data.alarms.map((a, i) => (
                                    <tr key={i}>
                                        <td><span className="mono">{a.AlarmName}</span></td>
                                        <td><span className={`badge ${a.StateValue === 'OK' ? 'badge-green' : a.StateValue === 'ALARM' ? 'badge-red' : 'badge-amber'}`}>{a.StateValue}</span></td>
                                        <td>{a.MetricName || '—'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    ) : <p className="result-empty">No alarms found.</p>}
                </div>
            );
        }

        // Generic message result
        if (data.message) {
            return <p className="result-message">{data.message}</p>;
        }

        // ARN or creation result
        if (data.arn || data.bucket || data.queueUrl || data.topicArn) {
            return (
                <div className="result-kv">
                    {Object.entries(data).filter(([k, v]) => v && typeof v !== 'object').map(([k, v]) => (
                        <div key={k} className="result-kv-row">
                            <span className="result-kv-key">{k}</span>
                            <span className="result-kv-val mono">{v}</span>
                        </div>
                    ))}
                </div>
            );
        }

        return null;
    };

    return (
        <div className={`result-card ${success ? 'result-success' : 'result-error'}`}>
            <div className="result-header">
                <div className="result-icon-wrap">
                    <Icon size={15} />
                </div>
                <div className="result-meta">
                    {intent && <span className="result-service">{intent.service} → {intent.action}</span>}
                    {processingTimeMs !== undefined && (
                        <span className="result-time"><Clock size={10} /> {processingTimeMs}ms</span>
                    )}
                </div>
                <div className="result-actions">
                    {consoleUrl && (
                        <a href={consoleUrl} target="_blank" rel="noreferrer" className="btn btn-icon" title="Open in AWS Console">
                            <ExternalLink size={12} />
                        </a>
                    )}
                    {data && (
                        <button className="btn btn-icon" onClick={copyRaw} title="Copy raw JSON">
                            <Copy size={12} />
                        </button>
                    )}
                </div>
            </div>

            <div className="result-body">
                {renderContent()}
                {suggestions && suggestions.length > 0 && (
                    <div className="result-suggestions">
                        <p className="suggestions-label">Try:</p>
                        <div className="suggestions-chips">
                            {suggestions.map((s, i) => (
                                <button key={i} className="suggestion-chip">{s}</button>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {data && (
                <div className="result-raw">
                    <button className="result-raw-toggle" onClick={() => setShowRaw(r => !r)}>
                        {showRaw ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                        <span>Raw JSON</span>
                        {copied && <span className="copied-label">Copied!</span>}
                    </button>
                    {showRaw && (
                        <pre className="result-raw-code">{JSON.stringify(data, null, 2)}</pre>
                    )}
                </div>
            )}
        </div>
    );
}
