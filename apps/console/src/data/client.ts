/**
 * The console data layer.
 *
 * All spend and inference reads flow through a single `@conduit/client` in
 * gateway mode. By default the client is wired to a local mock adapter so the
 * built site works with no backend. Point it at a real deployment by setting
 * VITE_CONDUIT_BASE_URL and VITE_CONDUIT_API_KEY at build time; the mock is used
 * whenever a base URL is absent.
 */
import { createClient } from "@conduit/client";
import type { ConduitClient } from "@conduit/client";
import { mockGatewayFetch } from "./mockGateway.ts";

const baseUrl = import.meta.env.VITE_CONDUIT_BASE_URL;
const apiKey = import.meta.env.VITE_CONDUIT_API_KEY ?? "sample-key";

export const usingMockGateway = !baseUrl;

export const client: ConduitClient = createClient({
  mode: "gateway",
  baseUrl: baseUrl ?? "https://gateway.local",
  apiKey,
  fetch: usingMockGateway ? mockGatewayFetch : (globalThis.fetch as unknown as typeof mockGatewayFetch),
});
