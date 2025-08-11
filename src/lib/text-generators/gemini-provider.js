import { GoogleGenerativeAI, GoogleGenerativeAIFetchError } from "@google/generative-ai";

export class GeminiProvider {
    constructor(config) {
        this.config = config;
        this.genAI = null;
        this.model = null;
    }

    _initialize() {
        if (!this.genAI) {
            const apiKey = process.env[this.config.apiKeyEnv];
            if (!apiKey) {
                throw new Error(`[GEMINI-TEXT-PROVIDER-FATAL] API key environment variable "${this.config.apiKeyEnv}" is not set.`);
            }
            this.genAI = new GoogleGenerativeAI(apiKey);
            this.model = this.genAI.getGenerativeModel({ model: this.config.model });
        }
    }

    async generate(prompt, safetySettings) {
        this._initialize();
        // Simplified for plan - actual implementation would include retry logic
        const result = await this.model.generateContent({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            safetySettings
        });
        return (await result.response).text();
    }
}