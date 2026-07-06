import type { VideoModelProvider } from "@shared/types/ai";

export class ProviderRegistry {
  private readonly providers = new Map<string, VideoModelProvider>();

  constructor(providers: VideoModelProvider[]) {
    providers.forEach((provider) => this.register(provider));
  }

  register(provider: VideoModelProvider): void {
    const capabilities = provider.getCapabilities();
    this.providers.set(capabilities.providerId, provider);
  }

  get(providerId: string): VideoModelProvider {
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new Error(`Unknown video model provider: ${providerId}`);
    }

    return provider;
  }

  list(): VideoModelProvider[] {
    return [...this.providers.values()];
  }
}
