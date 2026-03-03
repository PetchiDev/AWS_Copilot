import React from 'react';
import { motion } from 'framer-motion';
import { User, Bot } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import ResultCard from './ResultCard';
import ResourceChart from './ResourceChart';
import './MessageBubble.css';

// Typing indicator dots
function TypingIndicator() {
    return (
        <div className="typing-indicator">
            <span className="typing-dot" style={{ animationDelay: '0ms' }} />
            <span className="typing-dot" style={{ animationDelay: '150ms' }} />
            <span className="typing-dot" style={{ animationDelay: '300ms' }} />
        </div>
    );
}

export default function MessageBubble({ message, isLoading }) {
    const isUser = message?.role === 'user';

    // Render the loading bubble
    if (isLoading && !message) {
        return (
            <motion.div
                className="bubble-row bubble-row-assistant"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
            >
                <div className="bubble-avatar bubble-avatar-assistant"><Bot size={14} /></div>
                <div className="bubble bubble-assistant bubble-loading">
                    <TypingIndicator />
                </div>
            </motion.div>
        );
    }

    return (
        <motion.div
            className={`bubble-row ${isUser ? 'bubble-row-user' : 'bubble-row-assistant'}`}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
        >
            {!isUser && (
                <div className="bubble-avatar bubble-avatar-assistant"><Bot size={14} /></div>
            )}

            {/* Parse Chart Data if present */}
            {(() => {
                const chartMatch = !isUser && message.content ? message.content.match(/\[CHART:\s*({.*?})\]/s) : null;
                let chartConfig = null;
                let cleanedContent = message.content;

                if (chartMatch) {
                    try {
                        chartConfig = JSON.parse(chartMatch[1]);
                        cleanedContent = message.content.replace(chartMatch[0], '').trim();
                    } catch (e) {
                        console.error("Failed to parse chart data:", e);
                    }
                }

                return (
                    <div className={`bubble ${isUser ? 'bubble-user' : 'bubble-assistant'}`}>
                        <div className="bubble-content">
                            <div className="markdown-content">
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                    {cleanedContent}
                                </ReactMarkdown>
                            </div>
                        </div>

                        {/* Chart Visualization */}
                        {chartConfig && (
                            <div className="bubble-chart">
                                <ResourceChart config={chartConfig} />
                            </div>
                        )}

                {/* Welcome suggestions */}
                {message.suggestions && !message.data && (
                    <div className="bubble-suggestions">
                        {message.suggestions.map((s, i) => (
                            <div key={i} className="bubble-chip">{s}</div>
                        ))}
                    </div>
                )}

                {/* AWS Result */}
                {message.data && (
                    <div className="bubble-result">
                        <ResultCard
                            data={message.data}
                            intent={message.intent}
                            success={message.success}
                            processingTimeMs={message.processingTimeMs}
                            suggestions={message.suggestions}
                        />
                    </div>
                )}

                    {/* Timestamp */}
                    <span className="bubble-time">
                        {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                </div>
                );
            })()}

            {isUser && (
                <div className="bubble-avatar bubble-avatar-user"><User size={14} /></div>
            )}
        </motion.div>
    );
}
