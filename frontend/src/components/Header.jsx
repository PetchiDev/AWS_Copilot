import React from 'react';
import { Cloud, LogOut, Wifi, WifiOff, ChevronDown, RefreshCw } from 'lucide-react';
import './Header.css';

const AWS_REGIONS = [
    'ap-south-1', 'ap-southeast-1', 'ap-southeast-2', 'ap-northeast-1',
    'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2',
    'eu-west-1', 'eu-west-2', 'eu-central-1', 'ca-central-1', 'sa-east-1'
];

export default function Header({ isConfigured, region, setRegion, account, arn, onLogout, onCheckAuth }) {
    return (
        <header className="header">
            <div className="header-brand">
                <div className="header-logo">
                    <Cloud size={22} color="#ff9900" />
                </div>
                <div>
                    <h1 className="header-title">AWS Copilot</h1>
                    <p className="header-subtitle">Natural Language AWS Manager</p>
                </div>
            </div>

            <div className="header-center">
                {isConfigured && (
                    <div className="region-selector">
                        <select
                            value={region}
                            onChange={e => setRegion(e.target.value)}
                            className="region-select"
                        >
                            {AWS_REGIONS.map(r => (
                                <option key={r} value={r}>{r}</option>
                            ))}
                        </select>
                        <ChevronDown size={14} className="region-chevron" />
                    </div>
                )}
            </div>

            <div className="header-actions">
                <div className={`status-badge ${isConfigured ? 'status-connected' : 'status-disconnected'}`}>
                    {isConfigured
                        ? <><Wifi size={12} /> <span>Connected</span></>
                        : <><WifiOff size={12} /> <span>Not Connected</span></>
                    }
                </div>

                {isConfigured && account && (
                    <div className="account-info">
                        <span className="account-label">Account:</span>
                        <span className="account-id">{account}</span>
                    </div>
                )}

                <button
                    className="btn btn-icon"
                    onClick={onCheckAuth}
                    title="Refresh connection"
                >
                    <RefreshCw size={14} />
                </button>

                {isConfigured && (
                    <button className="btn btn-danger" onClick={onLogout}>
                        <LogOut size={14} /> Logout
                    </button>
                )}
            </div>
        </header>
    );
}
