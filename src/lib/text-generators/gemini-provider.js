import { GoogleGenerativeAI, GoogleGenerativeAIFetchError } from "@google/generative-ai";

export class GeminiProvider {
    constructor(config) {
        this.genAI = new GoogleGenerativeAI(process.env[config.apiKeyEnv]);
        this.model = this.genAI.getGenerativeModel({ model: config.model });
    }

    async generate(prompt, safetySettings) {
        // Simplified for plan - actual implementation would include retry logic
        const result = await this.model.generateContent({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            safetySettings
        });
        return (await result.response).text();
    }
}
