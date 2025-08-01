import { GeminiProvider } from './gemini-provider.js';
import { OpenAIProvider } from './openai-provider.js';
import { DeepSeekProvider } from './deepseek-provider.js';
import { KimiProvider } from './kimi-provider.js';

export function getTextGenerator(config) {
    const providerName = config.textGeneration.provider;
    const providerConfig = config.textGeneration.providers[providerName];

    switch (providerName) {
        case 'gemini':
            return new GeminiProvider(providerConfig);
        case 'openai':
            return new OpenAIProvider(providerConfig);
        case 'deepseek':
            return new DeepSeekProvider(providerConfig);
        case 'kimi':
            return new KimiProvider(providerConfig);
        default:
            throw new Error(`Unknown text generation provider: ${providerName}`);
    }
}
