import providerData from '../../ai-providers.json';

export const AI_PROVIDERS = providerData.providers as unknown as readonly ['openai', 'anthropic', 'google'];
export type AIProvider = (typeof AI_PROVIDERS)[number];

export const AI_MODELS: Record<AIProvider, readonly string[]> = providerData.models;

export function isValidProviderModel(provider: string, model: string): boolean {
  if (!(AI_PROVIDERS as readonly string[]).includes(provider)) return false;
  return (AI_MODELS[provider as AIProvider] as readonly string[]).includes(model);
}
