import OpenAI from 'openai';

export class OpenAIProvider {
    constructor(config) {
        this.openai = new OpenAI({ apiKey: process.env[config.apiKeyEnv] });
        this.config = config;
    }

    async generate(prompt) {
        const completion = await this.openai.chat.completions.create({
            model: this.config.model,
            messages: [{ role: 'user', content: prompt }],
        });
        return completion.choices[0].message.content;
    }
}
