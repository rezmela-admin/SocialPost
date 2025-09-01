import { GeminiProvider } from './gemini-provider.js';
import { OpenAIProvider } from './openai-provider.js';
import { DeepSeekProvider } from './deepseek-provider.js';
import { KimiProvider } from './kimi-provider.js';

export function getTextGenerator(sessionState) {
    const textConfig = sessionState.textGeneration;
    const providerName = textConfig.provider;

    if (!providerName || !textConfig.providers || !textConfig.providers[providerName]) {
        throw new Error('[TEXT-FACTORY-FATAL] Text generation "provider" is not specified or invalid in config.json.');
    }

    const providerConfig = textConfig.providers[providerName];
    // Combine the specific provider config with any top-level settings
    const finalConfig = { ...textConfig, ...providerConfig };

    switch (providerName) {
        case 'gemini':
            return new GeminiProvider(finalConfig);
        case 'openai':
            return new OpenAIProvider(finalConfig);
        case 'deepseek':
            return new DeepSeekProvider(finalConfig);
        case 'kimi':
            return new KimiProvider(finalConfig);
        default:
            throw new Error(`Unknown text generation provider: ${providerName}`);
    }
}
