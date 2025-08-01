import axios from 'axios';

export class DeepSeekProvider {
    constructor(config) {
        this.config = config;
        this.apiKey = process.env[config.apiKeyEnv];
    }

    async generate(prompt) {
        const response = await axios.post(this.config.apiUrl, {
            model: this.config.model,
            messages: [{ role: 'user', content: prompt }],
        }, {
            headers: { 'Authorization': `Bearer ${this.apiKey}` }
        });
        return response.data.choices[0].message.content;
    }
}
