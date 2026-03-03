import { useState, useCallback, useRef } from 'react';
import { executePrompt } from '../services/api';

export function useChat() {
    const [messages, setMessages] = useState([
        {
            id: 'welcome',
            role: 'assistant',
            content: 'Hello! I\'m your AWS Copilot 🚀\n\nI can help you manage your AWS resources using natural language. Try asking me:',
            suggestions: [
                'List all S3 buckets',
                'Create an S3 bucket named my-bucket in ap-south-1',
                'List Lambda functions',
                'List EC2 instances',
                'List DynamoDB tables',
                'Show CloudWatch alarms'
            ],
            timestamp: new Date().toISOString()
        }
    ]);
    const [loading, setLoading] = useState(false);
    const [currentRegion, setCurrentRegion] = useState('ap-south-1');

    // ── Two-way conversation context ───────────────────────────────────
    // Stores the pending intent when the AI is waiting for a clarification
    const pendingContextRef = useRef(null); // { pendingIntent, missingKey }

    const sendMessage = useCallback(async (prompt) => {
        if (!prompt.trim() || loading) return;

        const userMsg = {
            id: `user-${Date.now()}`,
            role: 'user',
            content: prompt,
            timestamp: new Date().toISOString()
        };
        setMessages(prev => [...prev, userMsg]);
        setLoading(true);

        try {
            // Attach pending context if we were waiting for a clarification answer
            const context = pendingContextRef.current || undefined;
            const data = await executePrompt(prompt, currentRegion, context);

            // ── Handle conversational / needsMoreInfo responses ──────────
            if (data.needsMoreInfo && data.pendingContext) {
                // Store context so next message auto-executes with resolved param
                pendingContextRef.current = data.pendingContext;
            } else {
                // Got a real result or resolved → clear pending context
                pendingContextRef.current = null;
            }

            const isConversational = data.conversational || data.needsMoreInfo;

            const assistantMsg = {
                id: `ai-${Date.now()}`,
                role: 'assistant',
                // Priority: Gemini's smart analysis → conversational message → generic header
                content: data.aiAnalysis
                    ? data.aiAnalysis              // 🤖 Gemini intelligent answer
                    : isConversational
                        ? (data.result?.message || data.question || data.error || '')
                        : data.success
                            ? ` **${data.intent?.service || 'AWS'} → ${data.intent?.action || 'Action'}** completed successfully`
                            : `❌ ${data.error}`,
                data: data.result,
                intent: data.intent,
                success: data.success,
                aiPowered: !!data.aiAnalysis,     // flag to show Gemini badge in UI
                conversational: isConversational,
                needsMoreInfo: data.needsMoreInfo,
                processingTimeMs: data.processingTimeMs,
                suggestions: data.suggestions,
                timestamp: data.timestamp || new Date().toISOString()
            };


            setMessages(prev => [...prev, assistantMsg]);

        } catch (err) {
            // On error, clear pending context so user can start fresh
            pendingContextRef.current = null;
            const errMsg = {
                id: `err-${Date.now()}`,
                role: 'assistant',
                content: `❌ ${err.response?.data?.error || err.message || 'An error occurred'}`,
                success: false,
                requiresAuth: err.message?.includes('credentials'),
                timestamp: new Date().toISOString()
            };
            setMessages(prev => [...prev, errMsg]);
        } finally {
            setLoading(false);
        }
    }, [loading, currentRegion]);

    const clearMessages = useCallback(() => {
        pendingContextRef.current = null;
        setMessages([{
            id: 'welcome-clear',
            role: 'assistant',
            content: 'Chat cleared! How can I help you with AWS today?',
            suggestions: [
                'List all S3 buckets',
                'List Lambda functions',
                'Create an IAM access key for me',
                'Show CloudWatch alarms'
            ],
            timestamp: new Date().toISOString()
        }]);
    }, []);

    return { messages, loading, sendMessage, clearMessages, currentRegion, setCurrentRegion };
}
