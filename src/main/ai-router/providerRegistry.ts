import type { ProviderAdapter } from "@shared/ai-routing";

export class AiProviderRegistry {
  private readonly adapters = new Map<string, ProviderAdapter>();

  constructor(adapters: ProviderAdapter[]) {
    adapters.forEach((adapter) => this.register(adapter));
  }

  register(adapter: ProviderAdapter): void {
    this.adapters.set(adapter.providerId, adapter);
  }

  get(providerId: string): ProviderAdapter {
    const adapter = this.adapters.get(providerId);
    if (!adapter) {
      throw new Error(`Unknown AI provider adapter: ${providerId}`);
    }

    return adapter;
  }

  list(): ProviderAdapter[] {
    return [...this.adapters.values()];
  }
}
