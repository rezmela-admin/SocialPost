import OpenAI from 'openai';

export class OpenAIProvider {
    constructor(config) {
        this.config = config;
        this.openai = null;
    }

    _initialize() {
        if (!this.openai) {
            const apiKey = process.env[this.config.apiKeyEnv];
            if (!apiKey) {
                throw new Error(`[OPENAI-TEXT-PROVIDER-FATAL] API key environment variable "${this.config.apiKeyEnv}" is not set.`);
            }
            this.openai = new OpenAI({ apiKey });
        }
    }

    async generate(prompt) {
        this._initialize();
        const completion = await this.openai.chat.completions.create({
            model: this.config.model,
            messages: [{ role: 'user', content: prompt }],
        });
        return completion.choices[0].message.content;
    }
}