import axios from 'axios';

export class DeepSeekProvider {
    constructor(config) {
        this.config = config;
        this.apiKey = null;
    }

    _initialize() {
        if (!this.apiKey) {
            const apiKey = process.env[this.config.apiKeyEnv];
            if (!apiKey) {
                throw new Error(`[DEEPSEEK-PROVIDER-FATAL] API key environment variable "${this.config.apiKeyEnv}" is not set.`);
            }
            this.apiKey = apiKey;
        }
    }

    async generate(prompt) {
        this._initialize();
        const response = await axios.post(this.config.apiUrl, {
            model: this.config.model,
            messages: [{ role: 'user', content: prompt }],
        }, {
            headers: { 'Authorization': `Bearer ${this.apiKey}` }
        });
        return response.data.choices[0].message.content;
    }
}