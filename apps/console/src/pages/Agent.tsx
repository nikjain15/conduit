import { useEffect, useState } from "react";
import { SKILL_NAMES, TOOL_NAMES } from "@conduit/profile";
import type { UseCaseProfile } from "@conduit/client";
import { client } from "../data/client.ts";
import { SAMPLE_NOTICE } from "../data/sample.ts";
import { useProfiles } from "./useProfiles.ts";

type Agent = NonNullable<UseCaseProfile["agent"]>;

/** Tool options: the registered tool names, plus any tool a loaded profile
 *  already names that is not registered, so an existing config never renders
 *  with a silently missing checkbox. */
function toolOptions(profiles: UseCaseProfile[]): string[] {
  const names = new Set<string>(TOOL_NAMES);
  for (const p of profiles) for (const t of p.agent?.tools ?? []) names.add(t);
  return [...names];
}

/** Skill options: the registered skill ids, plus any already named on a profile. */
function skillOptions(profiles: UseCaseProfile[]): string[] {
  const names = new Set<string>(SKILL_NAMES);
  for (const p of profiles) for (const s of p.agent?.skills ?? []) names.add(s);
  return [...names];
}

/** A default agent block when a use case turns the agent on. */
function defaultAgent(): Agent {
  return { mode: "loop", tools: [], skills: [], maxSteps: 6 };
}

/** Parse a numeric field: blank leaves the value undefined. */
function parseNum(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}

/** Toggle a name in a string list, preserving order. */
function toggle(list: string[], name: string, on: boolean): string[] {
  if (on) return list.includes(name) ? list : [...list, name];
  return list.filter((n) => n !== name);
}

export function Agent() {
  const { profiles, status } = useProfiles();
  const [draft, setDraft] = useState<UseCaseProfile[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [saveState, setSaveState] = useState<string>("");

  // Take a working copy once profiles load, so edits are local until saved.
  useEffect(() => {
    if (status === "ready" && profiles.length > 0) {
      setDraft(
        profiles.map((p) => ({
          ...p,
          agent: p.agent
            ? { ...p.agent, tools: [...p.agent.tools], skills: [...p.agent.skills] }
            : p.agent,
        })),
      );
      setActiveId((prev) => prev || profiles[0].id);
    }
  }, [status, profiles]);

  const tools = toolOptions(profiles);
  const skills = skillOptions(profiles);
  const active = draft.find((p) => p.id === activeId);

  function editAgent(mutate: (a: Agent) => Agent) {
    setDraft((prev) =>
      prev.map((p) => {
        if (p.id !== activeId) return p;
        return { ...p, agent: mutate(p.agent ?? defaultAgent()) };
      }),
    );
    setSaveState("");
  }

  function setEnabled(enabled: boolean) {
    setDraft((prev) =>
      prev.map((p) =>
        p.id === activeId ? { ...p, agent: enabled ? p.agent ?? defaultAgent() : undefined } : p,
      ),
    );
    setSaveState("");
  }

  async function save() {
    if (!active || !client.updateProfile) return;
    setSaveState("Saving.");
    try {
      await client.updateProfile(active);
      setSaveState("Saved. Edits round-trip through the gateway.");
    } catch {
      setSaveState("Save failed.");
    }
  }

  if (status === "loading") {
    return (
      <section className="page">
        <h2>Agent</h2>
        <p className="lead">Loading use case profiles.</p>
      </section>
    );
  }

  if (status === "error" || !active) {
    return (
      <section className="page">
        <h2>Agent</h2>
        <p className="lead">Could not load use case profiles.</p>
      </section>
    );
  }

  const agent = active.agent;
  const enabled = !!agent;

  return (
    <section className="page">
      <h2>Agent</h2>
      <p className="lead">
        The agent loop each use case runs: single shot or a tool use loop, the tools and skills it may
        call, and the step budget. Tools and skills come from the shared registries. Use cases with no
        agent block run inference directly.
      </p>
      <span className="notice">{SAMPLE_NOTICE}</span>

      <div className="field" style={{ maxWidth: 360 }}>
        <label htmlFor="agent-usecase">Use case</label>
        <select
          id="agent-usecase"
          aria-label="Use case"
          value={activeId}
          onChange={(e) => {
            setActiveId(e.target.value);
            setSaveState("");
          }}
        >
          {draft.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      <div className="card">
        <div className="field">
          <label htmlFor="agent-enabled">
            <input
              id="agent-enabled"
              type="checkbox"
              aria-label="Enable agent"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />{" "}
            Run an agent for this use case
          </label>
        </div>

        {!enabled && (
          <p className="muted" style={{ fontSize: 13 }}>
            No agent block for this use case. It answers from inference directly, with no tools or agent
            loop. Enable the agent to configure its mode, tools, and skills.
          </p>
        )}

        {enabled && agent && (
          <>
            <div className="field">
              <label htmlFor="agent-mode">Mode</label>
              <select
                id="agent-mode"
                aria-label="Mode"
                value={agent.mode}
                onChange={(e) =>
                  editAgent((a) => ({ ...a, mode: e.target.value as Agent["mode"] }))
                }
              >
                <option value="single">single</option>
                <option value="loop">loop</option>
              </select>
            </div>

            {agent.mode === "loop" && (
              <div className="field">
                <label htmlFor="agent-maxsteps">Max steps</label>
                <input
                  id="agent-maxsteps"
                  type="number"
                  aria-label="Max steps"
                  value={agent.maxSteps ?? ""}
                  onChange={(e) => editAgent((a) => ({ ...a, maxSteps: parseNum(e.target.value) }))}
                />
              </div>
            )}

            <div className="field">
              <label>Tools</label>
              <div>
                {tools.map((t) => (
                  <label key={t} className="toggle-row">
                    <input
                      type="checkbox"
                      aria-label={`Tool ${t}`}
                      checked={agent.tools.includes(t)}
                      onChange={(e) => editAgent((a) => ({ ...a, tools: toggle(a.tools, t, e.target.checked) }))}
                    />{" "}
                    <span className="mono">{t}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="field">
              <label>Skills</label>
              <div>
                {skills.map((s) => (
                  <label key={s} className="toggle-row">
                    <input
                      type="checkbox"
                      aria-label={`Skill ${s}`}
                      checked={agent.skills.includes(s)}
                      onChange={(e) => editAgent((a) => ({ ...a, skills: toggle(a.skills, s, e.target.checked) }))}
                    />{" "}
                    <span className="mono">{s}</span>
                  </label>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      <div className="actions">
        <button type="button" className="link-action" onClick={() => void save()}>
          Save changes
        </button>
        {saveState && <span className="action-result">{saveState}</span>}
      </div>
    </section>
  );
}
