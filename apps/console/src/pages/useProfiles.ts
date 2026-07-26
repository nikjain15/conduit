import { useEffect, useState } from "react";
import { client } from "../data/client.ts";
import type { UseCaseProfile } from "@conduit/client";

export type ProfilesStatus = "loading" | "ready" | "error";

/**
 * Load every use case profile from the gateway. The Prompts, Guardrails, and
 * Agent tabs share this: each reads the sub section it owns from the same
 * profile objects. The read is one call to the optional profiles() method.
 */
export function useProfiles(): { profiles: UseCaseProfile[]; status: ProfilesStatus } {
  const [profiles, setProfiles] = useState<UseCaseProfile[]>([]);
  const [status, setStatus] = useState<ProfilesStatus>("loading");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!client.profiles) {
        setStatus("error");
        return;
      }
      try {
        const res = await client.profiles();
        if (cancelled) return;
        setProfiles(res.profiles);
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { profiles, status };
}

/** The shared placeholder note every stub tab renders. */
export const EDITOR_COMING = "Editor coming in this section.";
