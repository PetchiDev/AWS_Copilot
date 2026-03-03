/**
 * geminiService.js
 * Google Gemini AI integration — analyzes real AWS data and generates
 * natural-language answers like a smart AWS assistant.
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ─── System Prompt ─────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are "AWS Copilot AI", a state-of-the-art cloud infrastructure expert.
Your goal is to provide high-end, professional, and technical analysis of AWS resource data.

STYLE & FORMATTING RULES:
1. ALWAYS use Markdown. Use # and ## for clear section headers.
2. ALWAYS prefer TABLES for listing multiple items (Buckets, Instances, Users, etc.).
3. Use **Bold** for emphasis on resource names, regions, and critical values.
4. Use > Blockquotes for "Copilot Insights" or "Best Practices".
5. Use \`code\` blocks for IDs and ARNs.
6. Use syntax-highlighted code blocks (\`\`\`python) for any code snippets.
7. ALWAYS append a "Provisioning Script (IaC)" section when resource creation is involved. Provide a concise Terraform or CloudFormation snippet for the described resource.
8. Be concise but "Wrestle" with the data — don't just repeat it; interpret it.
9. If data is empty, explain WHY (e.g., "No objects found. The bucket might be new or private.") and suggest a next step.
10. MINIMIZE the use of emojis. Use them only if absolutely necessary for critical alerts. Avoid generic checkmarks (✅) or party poppers.
11. VISUAL DATA: If the data contains trends or multiple comparable resources (e.g. storage sizes of 5+ buckets, CPU usage), ALWAYS include a structured chart block at the very end of your response in this EXACT format:
[CHART: {"type": "bar", "title": "Resource Comparison", "data": [{"name": "Resource1", "value": 10}, {"name": "Resource2", "value": 20}]}]
(Supports "bar" or "area" types).

Tone: Professional, helpful, and highly technical yet accessible.`;

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

/**
 * Generate context-aware Lambda code based on the user's natural language prompt.
 * Instead of "Hello World", this writes real logic (e.g. S3 uploads, DynamoDB inserts).
 */
async function generateSmartLambdaCode(userPrompt, functionName) {
    try {
        const model = genAI.getGenerativeModel({
            model: 'gemini-flash-latest',
            systemInstruction: "You are a specialized AWS Lambda code generator. Write only the Python 3.12 code. No explanations. No markdown markers."
        });

        const prompt = `Write a production-ready Python handler for an AWS Lambda function named "${functionName}". 
        The user goal is: "${userPrompt}". 
        Include necessary imports like 'boto3' or 'json'. 
        Return ONLY the raw code string without any markdown \`\`\` wrappers.`;

        const result = await model.generateContent(prompt);
        return result.response.text().trim().replace(/```python|```/g, '');
    } catch (err) {
        return `import json\ndef handler(event, context):\n    return {"statusCode": 200, "body": json.dumps("Hello from ${functionName}!")}`;
    }
}

module.exports = { 
    analyzeWithGemini, 
    generateClarifyingQuestion, 
    handleConversational,
    generateSmartLambdaCode 
};
