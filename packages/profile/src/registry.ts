/**
 * A generic named registry.
 *
 * Each follow up workstream registers its implementations into a shared
 * instance: eval methods, retrievers, tools, skills, prompts, and providers.
 * The profile only names these by string; the registry resolves the name to a
 * concrete item at run time. The registries ship empty here on purpose; the
 * scaffold owns the shape, the workstreams own the contents.
 */
export class Registry<T> {
  private readonly items = new Map<string, T>();

  constructor(readonly label: string) {}

  /** Register an item under a name. Re registering a name overwrites it. */
  register(name: string, item: T): this {
    this.items.set(name, item);
    return this;
  }

  /** Read an item, or undefined when the name is not registered. */
  get(name: string): T | undefined {
    return this.items.get(name);
  }

  /** Whether a name is registered. */
  has(name: string): boolean {
    return this.items.has(name);
  }

  /** All registered names, in insertion order. */
  list(): string[] {
    return [...this.items.keys()];
  }
}

/**
 * The named registry instances the platform shares. Empty now; each workstream
 * registers into the one it owns.
 */
export const methodRegistry = new Registry<unknown>("method");
export const retrieverRegistry = new Registry<unknown>("retriever");
export const toolRegistry = new Registry<unknown>("tool");
export const skillRegistry = new Registry<unknown>("skill");
export const promptRegistry = new Registry<unknown>("prompt");
export const providerRegistry = new Registry<unknown>("provider");
