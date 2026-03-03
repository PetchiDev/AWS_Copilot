import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Cloud, Eye, EyeOff, Lock, AlertCircle, ChevronDown,
    Check, ExternalLink, Loader2, ShieldCheck, Key, Copy, RefreshCw
} from 'lucide-react';
import axios from 'axios';
import './AwsLoginModal.css';

const AWS_REGIONS = [
    'ap-south-1', 'ap-southeast-1', 'ap-southeast-2', 'ap-northeast-1', 'ap-northeast-2',
    'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2',
    'eu-west-1', 'eu-west-2', 'eu-central-1', 'ca-central-1', 'sa-east-1', 'me-south-1'
];

const API = axios.create({ baseURL: 'http://localhost:5000' });

// ─── Custom Region Dropdown ────────────────────────────────────────
function RegionDropdown({ value, onChange }) {
    const [open, setOpen] = useState(false);
    const ref = useRef(null);

    useEffect(() => {
        const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
        document.addEventListener('mousedown', h);
        return () => document.removeEventListener('mousedown', h);
    }, []);

    return (
        <div className="region-dropdown" ref={ref}>
            <button type="button" className="region-trigger" onClick={() => setOpen(o => !o)}>
                <span className="region-dot" />
                <span>{value}</span>
                <ChevronDown size={14} className={`region-chevron ${open ? 'region-chevron-open' : ''}`} />
            </button>
            <AnimatePresence>
                {open && (
                    <motion.ul className="region-list"
                        initial={{ opacity: 0, y: -6, scaleY: 0.95 }}
                        animate={{ opacity: 1, y: 0, scaleY: 1 }}
                        exit={{ opacity: 0, y: -6, scaleY: 0.95 }}
                        transition={{ duration: 0.15 }}>
                        {AWS_REGIONS.map(r => (
                            <li key={r} className={`region-option ${r === value ? 'region-option-active' : ''}`}
                                onClick={() => { onChange(r); setOpen(false); }}>
                                <span>{r}</span>
                                {r === value && <Check size={12} className="region-check" />}
                            </li>
                        ))}
                    </motion.ul>
                )}
            </AnimatePresence>
        </div>
    );
}

// ─── Main Modal ────────────────────────────────────────────────────
export default function AwsLoginModal({ isOpen, onConfigure }) {
    const [tab, setTab] = useState('sso'); // 'sso' | 'key'

    // Manual key form
    const [form, setForm] = useState({ accessKeyId: '', secretAccessKey: '', region: 'ap-south-1', sessionToken: '' });
    const [showSecret, setShowSecret] = useState(false);

    // SSO form
    const [ssoForm, setSsoForm] = useState({ startUrl: '', region: 'ap-south-1' });
    const [ssoStep, setSsoStep] = useState('input'); // 'input' | 'code' | 'polling' | 'success'
    const [ssoData, setSsoData] = useState(null); // { verificationUri, userCode, expiresIn, interval }
    const [pollTimer, setPollTimer] = useState(null);
    const [copied, setCopied] = useState(false);

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    // Reset ALL state whenever modal opens (e.g. after logout)
    useEffect(() => {
        if (isOpen) {
            setTab('sso');
            setSsoStep('input');
            setSsoData(null);
            setError('');
            setCopied(false);
            setLoading(false);
            // cancel any in-progress poll timer
            if (pollTimer) { clearInterval(pollTimer); setPollTimer(null); }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen]);

    // Cleanup poll timer on unmount
    useEffect(() => () => { if (pollTimer) clearInterval(pollTimer); }, [pollTimer]);


    const resetError = () => setError('');

    // ── Manual AK/SK Login ─────────────────────────────────────────
    const handleKeySubmit = async (e) => {
        e.preventDefault();
        if (!form.accessKeyId.trim() || !form.secretAccessKey.trim()) {
            setError('Access Key ID and Secret Access Key are required.');
            return;
        }
        setLoading(true);
        setError('');
        try {
            const res = await API.post('/api/auth/configure', form);
            await onConfigure(res.data);
        } catch (err) {
            const msg = err.response?.data?.error || err.message || 'Failed to configure AWS credentials.';
            setError(msg);
        } finally {
            setLoading(false);
        }
    };

    // ── SSO Step 1: Start Device Auth ─────────────────────────────
    const handleSSOStart = async (e) => {
        e.preventDefault();
        if (!ssoForm.startUrl.trim()) {
            setError('AWS SSO Start URL is required.');
            return;
        }
        setLoading(true);
        setError('');
        try {
            const res = await API.post('/api/auth/sso/start', ssoForm);
            setSsoData(res.data);
            setSsoStep('code');
            // Auto-open verification URL
            window.open(res.data.verificationUri, '_blank', 'noopener');
        } catch (err) {
            setError(err.response?.data?.error || err.message || 'Failed to start SSO login.');
        } finally {
            setLoading(false);
        }
    };

    // ── SSO Step 2: Poll for approval ─────────────────────────────
    const startPolling = useCallback(() => {
        setSsoStep('polling');
        const interval = (ssoData?.interval || 5) * 1000;

        const timer = setInterval(async () => {
            try {
                const res = await API.post('/api/auth/sso/poll');
                if (res.data.status === 'success') {
                    clearInterval(timer);
                    setPollTimer(null);
                    setSsoStep('success');
                    setTimeout(() => onConfigure(res.data), 1000);
                }
                // If pending, keep polling
            } catch (err) {
                clearInterval(timer);
                setPollTimer(null);
                const errMsg = err.response?.data?.error || err.message || 'Polling failed. Please try again.';
                // Check if it's a grant/session error → go back to input for fresh start
                const isGrantError = errMsg.toLowerCase().includes('expired') ||
                    errMsg.toLowerCase().includes('already used') ||
                    errMsg.toLowerCase().includes('access denied') ||
                    errMsg.toLowerCase().includes('no sso session') ||
                    err.response?.data?.code === 'InvalidGrantException';
                setSsoStep(isGrantError ? 'input' : 'code');
                setError(errMsg);
            }

        }, interval);

        setPollTimer(timer);
    }, [ssoData, onConfigure]);

    const handleCopyCode = () => {
        if (ssoData?.userCode) {
            navigator.clipboard.writeText(ssoData.userCode);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    const resetSSO = () => {
        if (pollTimer) { clearInterval(pollTimer); setPollTimer(null); }
        setSsoStep('input');
        setSsoData(null);
        setError('');
        setCopied(false);
    };

    const switchTab = (t) => {
        setTab(t);
        setError('');
        resetSSO();
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div className="modal-overlay"
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                    <motion.div className="modal-box"
                        initial={{ opacity: 0, y: 40, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 40, scale: 0.95 }}
                        transition={{ type: 'spring', damping: 25, stiffness: 300 }}>

                        {/* Header */}
                        <div className="modal-header">
                            <div className="modal-icon"><Cloud size={24} color="#ff9900" /></div>
                            <div>
                                <h2 className="modal-title">Connect to AWS</h2>
                                <p className="modal-subtitle">Choose your preferred login method</p>
                            </div>
                        </div>

                        {/* Tab switcher */}
                        <div className="modal-tabs">
                            <button
                                className={`modal-tab ${tab === 'sso' ? 'modal-tab-active' : ''}`}
                                onClick={() => switchTab('sso')}>
                                <ShieldCheck size={14} />
                                Professional (SSO)
                            </button>
                            <button
                                className={`modal-tab ${tab === 'key' ? 'modal-tab-active' : ''}`}
                                onClick={() => switchTab('key')}>
                                <Key size={14} />
                                Access Keys
                            </button>
                        </div>

                        {/* ── SSO TAB ── */}
                        {tab === 'sso' && (
                            <div className="modal-form">
                                {/* Step: Input */}
                                {ssoStep === 'input' && (
                                    <form onSubmit={handleSSOStart}>
                                        <div className="sso-info-box">
                                            <ShieldCheck size={16} color="#ff9900" />
                                            <p>Sign in using your company's <strong>AWS IAM Identity Center</strong>. No access keys needed — uses short-lived, temporary credentials.</p>
                                        </div>
                                        <div className="form-group" style={{ marginTop: '16px' }}>
                                            <label className="form-label">AWS SSO Start URL <span className="required">*</span></label>
                                            <input
                                                type="url"
                                                className="input-field"
                                                placeholder="https://my-company.awsapps.com/start"
                                                value={ssoForm.startUrl}
                                                onChange={e => { setSsoForm(f => ({ ...f, startUrl: e.target.value })); resetError(); }}
                                                autoComplete="off"
                                            />
                                            <span className="form-hint">Find this in your AWS IAM Identity Center dashboard</span>
                                        </div>
                                        <div className="form-group">
                                            <label className="form-label">SSO Region</label>
                                            <RegionDropdown value={ssoForm.region} onChange={r => setSsoForm(f => ({ ...f, region: r }))} />
                                        </div>
                                        {error && <div className="modal-error"><AlertCircle size={14} /><span>{error}</span></div>}
                                        <div className="modal-footer" style={{ marginTop: '20px' }}>
                                            <div className="modal-security"><Lock size={12} /><span>Temporary credentials — auto-expire</span></div>
                                            <button type="submit" className="btn btn-primary modal-submit" disabled={loading}>
                                                {loading ? <Loader2 size={14} className="spin" /> : <><ShieldCheck size={14} /> Continue with SSO</>}
                                            </button>
                                        </div>
                                    </form>
                                )}

                                {/* Step: Show Code */}
                                {ssoStep === 'code' && ssoData && (
                                    <div className="sso-code-container">
                                        <div className="sso-step-badge">Step 1 of 2 — Approve in Browser</div>
                                        <p className="sso-instruction">
                                            A browser tab has opened. If not, <a href={ssoData.verificationUri} target="_blank" rel="noopener noreferrer" className="sso-link">click here</a>.
                                        </p>
                                        <div className="sso-code-box">
                                            <span className="sso-label">Enter this code in your browser:</span>
                                            <div className="sso-code-display">
                                                <span className="sso-code-text">{ssoData.userCode}</span>
                                                <button type="button" className="sso-copy-btn" onClick={handleCopyCode}>
                                                    {copied ? <Check size={14} /> : <Copy size={14} />}
                                                    {copied ? 'Copied!' : 'Copy'}
                                                </button>
                                            </div>
                                        </div>
                                        <div className="sso-url-box">
                                            <a href={ssoData.verificationUri} target="_blank" rel="noopener noreferrer" className="sso-url-link">
                                                <ExternalLink size={13} />
                                                Open verification page
                                            </a>
                                        </div>
                                        {error && <div className="modal-error"><AlertCircle size={14} /><span>{error}</span></div>}
                                        <div className="sso-actions">
                                            <button type="button" className="btn btn-secondary" onClick={resetSSO}>
                                                <RefreshCw size={13} /> Start Over
                                            </button>
                                            <button type="button" className="btn btn-primary" onClick={startPolling}>
                                                <Check size={14} /> I've Approved — Continue
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {/* Step: Polling */}
                                {ssoStep === 'polling' && (
                                    <div className="sso-polling">
                                        <div className="sso-spinner-large">
                                            <Loader2 size={40} className="spin" color="#ff9900" />
                                        </div>
                                        <p className="sso-polling-title">Waiting for your approval...</p>
                                        <p className="sso-polling-sub">Go to your browser and approve the sign-in request.<br />This page will update automatically.</p>
                                        <button type="button" className="btn btn-secondary" onClick={resetSSO} style={{ marginTop: '20px' }}>
                                            Cancel
                                        </button>
                                    </div>
                                )}

                                {/* Step: Success */}
                                {ssoStep === 'success' && (
                                    <div className="sso-success">
                                        <div className="sso-success-icon">
                                            <Check size={32} color="#34d399" />
                                        </div>
                                        <p className="sso-success-title"> Successfully Connected!</p>
                                        <p className="sso-polling-sub">Redirecting you to the dashboard...</p>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* ── ACCESS KEY TAB ── */}
                        {tab === 'key' && (
                            <form onSubmit={handleKeySubmit} className="modal-form">
                                <div className="form-group">
                                    <label className="form-label">Access Key ID <span className="required">*</span></label>
                                    <input
                                        type="text" className="input-field"
                                        placeholder="AKIAIOSFODNN7EXAMPLE"
                                        value={form.accessKeyId}
                                        onChange={e => { setForm(f => ({ ...f, accessKeyId: e.target.value })); resetError(); }}
                                        autoComplete="off" spellCheck={false}
                                    />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Secret Access Key <span className="required">*</span></label>
                                    <div className="input-wrapper">
                                        <input
                                            type={showSecret ? 'text' : 'password'}
                                            className="input-field"
                                            placeholder="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
                                            value={form.secretAccessKey}
                                            onChange={e => { setForm(f => ({ ...f, secretAccessKey: e.target.value })); resetError(); }}
                                            autoComplete="off"
                                        />
                                        <button type="button" className="input-action" onClick={() => setShowSecret(s => !s)}>
                                            {showSecret ? <EyeOff size={14} /> : <Eye size={14} />}
                                        </button>
                                    </div>
                                </div>
                                <div className="form-row">
                                    <div className="form-group">
                                        <label className="form-label">Region</label>
                                        <RegionDropdown value={form.region} onChange={r => setForm(f => ({ ...f, region: r }))} />
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Session Token <span className="optional">(optional)</span></label>
                                        <input
                                            type="password" className="input-field"
                                            placeholder="Temporary session token"
                                            value={form.sessionToken}
                                            onChange={e => { setForm(f => ({ ...f, sessionToken: e.target.value })); resetError(); }}
                                            autoComplete="off"
                                        />
                                    </div>
                                </div>
                                {error && <div className="modal-error"><AlertCircle size={14} /><span>{error}</span></div>}
                                <div className="modal-footer">
                                    <div className="modal-security"><Lock size={12} /><span>Credentials stored in memory only. Never persisted to disk.</span></div>
                                    <button type="submit" className="btn btn-primary modal-submit" disabled={loading}>
                                        {loading ? <Loader2 size={14} className="spin" /> : <><Cloud size={14} /> Connect to AWS</>}
                                    </button>
                                </div>
                            </form>
                        )}
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
