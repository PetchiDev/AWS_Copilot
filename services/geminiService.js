/**
 * geminiService.js
 * Google Gemini AI integration — analyzes real AWS data and generates
 * natural-language answers like a smart AWS assistant.
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ─── System Prompt ─────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are an expert AWS cloud infrastructure assistant.
Your goal is to provide intelligent, human-like analysis of AWS resources.

Instructions:
- Analyze the provided JSON data and answer the user's question directly.
- Avoid technical jargon unless necessary.
- If asking about storage, calculate totals and highlight large files.
- If asking about quantity, list the names and states clearly.
- Use markdown for a premium, readable feel.
- If the data is empty (e.g., 0 objects in a bucket), acknowledge it but suggest why or what to do next.
- Keep responses concise but extremely helpful (Gemini style).`;

/**
 * Analyze AWS result data with Gemini and return a natural language answer.
 */
async function analyzeWithGemini(userQuestion, awsResult, intent) {
    try {
        const model = genAI.getGenerativeModel({
            model: 'gemini-flash-latest',
            systemInstruction: SYSTEM_PROMPT
        });

        const prompt = `User Question: "${userQuestion}"
Action: ${intent?.service} ${intent?.action}
Data: ${JSON.stringify(awsResult)}

Analyze the data above and answer the question in a helpful, conversational way.`;

        const result = await model.generateContent(prompt);
        return result.response.text();
    } catch (err) {
        console.error('Gemini error:', err.message);
        return null; // Fallback to standard result view if AI fails
    }
}

/**
 * Use Gemini to generate a smart clarifying question when params are missing.
 */
async function generateClarifyingQuestion(userQuestion, defaultQuestion, intent) {
    try {
        const model = genAI.getGenerativeModel({
            model: 'gemini-flash-latest',
            systemInstruction: SYSTEM_PROMPT
        });

        const prompt = `User asked: "${userQuestion}". Missing param for ${intent?.service} ${intent?.action}. Original question: "${defaultQuestion}". Improve this question to be more natural.`;
        const result = await model.generateContent(prompt);
        return result.response.text().trim();
    } catch {
        return defaultQuestion;
    }
}

/**
 * Use Gemini to handle purely conversational or ambiguous questions.
 * @param {string} userQuestion - User's message
 * @param {Object} awsContext - Optional context about connected account
 * @returns {Promise<string>} Response text
 */
async function handleConversational(userQuestion, awsContext = {}) {
    try {
        const model = genAI.getGenerativeModel({
            model: 'gemini-flash-latest',
            systemInstruction: SYSTEM_PROMPT
        });

        const contextStr = awsContext.region
            ? `The user is connected to AWS region: ${awsContext.region}`
            : '';

        const prompt = `
${contextStr}

USER: "${userQuestion}"

This is a general question or conversation. Respond helpfully as an AWS assistant.
If it's an AWS question you can't answer with real data (like billing/costs), explain what they can do.
Keep response under 100 words.`;

        const result = await model.generateContent(prompt);
        return result.response.text().trim();
    } catch {
        return null;
    }
}

module.exports = { analyzeWithGemini, generateClarifyingQuestion, handleConversational };
