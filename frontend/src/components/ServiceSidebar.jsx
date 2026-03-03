import React, { useState } from 'react';
import {
    Database, Server, Zap, HardDrive, Bell, MessageSquare,
    BarChart2, Shield, ChevronLeft, ChevronRight, Plus
} from 'lucide-react';
import './ServiceSidebar.css';

const SERVICES = [
    { key: 's3', label: 'S3', icon: HardDrive, color: '#34d399', prompts: ['List all S3 buckets', 'Create an S3 bucket named my-bucket in ap-south-1', 'List objects in bucket'] },
    { key: 'lambda', label: 'Lambda', icon: Zap, color: '#fbbf24', prompts: ['List Lambda functions', 'Invoke function MyFunc', 'Delete function MyFunc'] },
    { key: 'ec2', label: 'EC2', icon: Server, color: '#60a5fa', prompts: ['List EC2 instances', 'Start instance i-0123456789', 'Stop instance i-0123456789'] },
    { key: 'iam', label: 'IAM', icon: Shield, color: '#a78bfa', prompts: ['List IAM users', 'List IAM roles', 'List IAM policies'] },
    { key: 'dynamodb', label: 'DynamoDB', icon: Database, color: '#f97316', prompts: ['List DynamoDB tables', 'Create DynamoDB table MyTable', 'List items in table MyTable'] },
    { key: 'sqs', label: 'SQS', icon: MessageSquare, color: '#ec4899', prompts: ['List SQS queues', 'Create SQS queue my-queue'] },
    { key: 'sns', label: 'SNS', icon: Bell, color: '#fb7185', prompts: ['List SNS topics', 'Create SNS topic my-topic'] },
    { key: 'cloudwatch', label: 'CloudWatch', icon: BarChart2, color: '#38bdf8', prompts: ['Show CloudWatch alarms', 'List CloudWatch metrics'] },
];

export default function ServiceSidebar({ onPromptSelect }) {
    const [collapsed, setCollapsed] = useState(false);
    const [expanded, setExpanded] = useState(null);

    const handleService = (svc) => {
        if (collapsed) setCollapsed(false);
        setExpanded(expanded === svc.key ? null : svc.key);
    };

    return (
        <aside className={`sidebar ${collapsed ? 'sidebar-collapsed' : ''}`}>
            <div className="sidebar-top">
                <button
                    className="sidebar-toggle"
                    onClick={() => setCollapsed(c => !c)}
                    title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                >
                    {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
                </button>
                {!collapsed && <span className="sidebar-heading">Services</span>}
            </div>

            <nav className="sidebar-nav">
                {SERVICES.map((svc) => {
                    const Icon = svc.icon;
                    return (
                        <div key={svc.key} className="sidebar-item-group">
                            <button
                                className={`sidebar-item ${expanded === svc.key ? 'sidebar-item-active' : ''}`}
                                onClick={() => handleService(svc)}
                                title={svc.label}
                            >
                                <span className="sidebar-icon" style={{ color: svc.color }}>
                                    <Icon size={16} />
                                </span>
                                {!collapsed && <span className="sidebar-label">{svc.label}</span>}
                            </button>

                            {!collapsed && expanded === svc.key && (
                                <div className="sidebar-prompts">
                                    {svc.prompts.map((prompt, i) => (
                                        <button
                                            key={i}
                                            className="sidebar-prompt"
                                            onClick={() => onPromptSelect(prompt)}
                                        >
                                            <Plus size={10} className="prompt-plus" />
                                            <span>{prompt}</span>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })}
            </nav>
        </aside>
    );
}
