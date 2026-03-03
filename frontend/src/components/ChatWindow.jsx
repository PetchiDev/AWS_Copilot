import React, { useRef, useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Trash2, Sparkles } from 'lucide-react';
import MessageBubble from './MessageBubble';
import './ChatWindow.css';

const QUICK_PROMPTS = [
    'List all S3 buckets',
    'List Lambda functions',
    'List EC2 instances',
    'List IAM users',
    'List DynamoDB tables',
    'Show CloudWatch alarms',
];

export default function ChatWindow({ messages, loading, onSend, onClear, onAuthRequired, prefilledPrompt, setPrefilledPrompt }) {
    const [input, setInput] = useState('');
    const bottomRef = useRef(null);
    const inputRef = useRef(null);

    // Auto-scroll on new messages
    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, loading]);

    // Prefill prompt from sidebar click
    useEffect(() => {
        if (prefilledPrompt) {
            setInput(prefilledPrompt);
            setPrefilledPrompt('');
            inputRef.current?.focus();
        }
    }, [prefilledPrompt, setPrefilledPrompt]);

    const handleSubmit = useCallback((e) => {
        e?.preventDefault();
        const trimmed = input.trim();
        if (!trimmed) return;
        onSend(trimmed);
        setInput('');
    }, [input, onSend]);

    const handleKey = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSubmit();
        }
    };

    const handleQuickPrompt = (prompt) => {
        onSend(prompt);
    };

    return (
        <div className="chat-window">
            {/* Messages Area */}
            <div className="chat-messages">
                <div className="chat-messages-inner">
                    <AnimatePresence initial={false}>
                        {messages.map((msg) => (
                            <MessageBubble key={msg.id} message={msg} />
                        ))}
                        {loading && (
                            <MessageBubble key="loading" isLoading={true} />
                        )}
                    </AnimatePresence>
                    <div ref={bottomRef} />
                </div>
            </div>

            {/* Quick Prompts */}
            <div className="quick-prompts">
                <div className="quick-prompts-inner">
                    <Sparkles size={12} className="quick-icon" />
                    {QUICK_PROMPTS.map((p, i) => (
                        <button key={i} className="quick-btn" onClick={() => handleQuickPrompt(p)} disabled={loading}>
                            {p}
                        </button>
                    ))}
                </div>
            </div>

            {/* Input Area */}
            <div className="chat-input-area">
                <div className="chat-input-row">
                    <button
                        className="btn btn-icon clear-btn"
                        onClick={onClear}
                        title="Clear chat"
                    >
                        <Trash2 size={14} />
                    </button>

                    <form className="input-form" onSubmit={handleSubmit}>
                        <textarea
                            ref={inputRef}
                            className="chat-textarea"
                            value={input}
                            onChange={e => setInput(e.target.value)}
                            onKeyDown={handleKey}
                            placeholder="Ask anything... e.g. 'Create S3 bucket named test-bucket in ap-south-1'"
                            rows={1}
                            disabled={loading}
                        />
                        <button
                            type="submit"
                            className={`send-btn ${input.trim() && !loading ? 'send-btn-active' : ''}`}
                            disabled={!input.trim() || loading}
                        >
                            {loading ? <span className="send-spinner" /> : <Send size={16} />}
                        </button>
                    </form>
                </div>
                <p className="chat-hint">Press <kbd>Enter</kbd> to send · <kbd>Shift+Enter</kbd> for new line</p>
            </div>
        </div>
    );
}
