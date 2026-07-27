import { useState } from "react";
import { SKILL_NAMES, TOOL_NAMES } from "@conduit/profile";
import type { UseCaseProfile } from "@conduit/client";
import { client } from "../data/client.ts";
import { appOfUseCase, SAMPLE_NOTICE } from "../data/sample.ts";
import { useProfiles } from "./useProfiles.ts";
import { AppHeading, groupByApp, UseCaseTag } from "./AppGroup.tsx";

type Agent = NonNullable<UseCaseProfile["agent"]>;

/** Tool options: the registered tool names, plus any tool a loaded profile
 *  already names that is not registered. */
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

function defaultAgent(): Agent {
  return { mode: "loop", tools: [], skills: [], maxSteps: 6 };
}

function parseNum(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}

function toggle(list: string[], name: string, on: boolean): string[] {
  if (on) return list.includes(name) ? list : [...list, name];
  return list.filter((n) => n !== name);
}

interface CardProps {
  profile: UseCaseProfile;
  tools: string[];
  skills: string[];
}

function AgentCard({ profile, tools, skills }: CardProps) {
  const [draft, setDraft] = useState<UseCaseProfile>(profile);
  const [saveState, setSaveState] = useState<string>("");
  const app = appOfUseCase(profile.id);
  const agent = draft.agent;
  const enabled = !!agent;

  function editAgent(mutate: (a: Agent) => Agent) {
    setDraft((p) => ({ ...p, agent: mutate(p.agent ?? defaultAgent()) }));
    setSaveState("");
  }

  function setEnabled(on: boolean) {
    setDraft((p) => ({ ...p, agent: on ? p.agent ?? defaultAgent() : undefined }));
    setSaveState("");
  }

  async function save() {
    if (!client.updateProfile) return;
    setSaveState("Saving.");
    try {
      await client.updateProfile(draft);
      setSaveState("Saved. Edits round-trip through the gateway.");
    } catch {
      setSaveState("Save failed.");
    }
  }

  return (
    <div className="card">
      <UseCaseTag app={app} useCase={profile.name} />
      <div className="field">
        <label htmlFor={`agent-enabled-${profile.id}`}>
          <input
            id={`agent-enabled-${profile.id}`}
            type="checkbox"
            aria-label={`Enable agent ${profile.id}`}
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
            <label htmlFor={`agent-mode-${profile.id}`}>Mode</label>
            <select
              id={`agent-mode-${profile.id}`}
              aria-label={`Mode ${profile.id}`}
              value={agent.mode}
              onChange={(e) => editAgent((a) => ({ ...a, mode: e.target.value as Agent["mode"] }))}
            >
              <option value="single">single</option>
              <option value="loop">loop</option>
            </select>
          </div>

          {agent.mode === "loop" && (
            <div className="field">
              <label htmlFor={`agent-maxsteps-${profile.id}`}>Max steps</label>
              <input
                id={`agent-maxsteps-${profile.id}`}
                type="number"
                aria-label={`Max steps ${profile.id}`}
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
                    aria-label={`Tool ${t} ${profile.id}`}
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
                    aria-label={`Skill ${s} ${profile.id}`}
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

      <div className="actions">
        <button type="button" className="link-action" aria-label={`Save ${profile.id}`} onClick={() => void save()}>
          Save changes
        </button>
        {saveState && <span className="action-result">{saveState}</span>}
      </div>
    </div>
  );
}

export function Agent() {
  const { profiles, status } = useProfiles();

  if (status === "loading") {
    return (
      <section className="page">
        <h2>Agent</h2>
        <p className="lead">Loading use case profiles.</p>
      </section>
    );
  }
  if (status === "error" || profiles.length === 0) {
    return (
      <section className="page">
        <h2>Agent</h2>
        <p className="lead">Could not load use case profiles.</p>
      </section>
    );
  }

  const tools = toolOptions(profiles);
  const skills = skillOptions(profiles);
  const groups = groupByApp(profiles, (p) => p.id);

  return (
    <section className="page">
      <h2>Agent</h2>
      <p className="lead">
        The agent loop each use case runs, grouped by app: single shot or a tool use loop, the tools and
        skills it may call, and the step budget. Tools and skills come from the shared registries. Use
        cases with no agent block run inference directly.
      </p>
      <span className="notice">{SAMPLE_NOTICE}</span>

      {groups.map((g) => (
        <div className="app-group" key={g.app}>
          <AppHeading label={g.label} count={g.items.length} />
          {g.items.map((p) => (
            <AgentCard key={p.id} profile={p} tools={tools} skills={skills} />
          ))}
        </div>
      ))}
    </section>
  );
}
