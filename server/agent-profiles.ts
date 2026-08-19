import "./env.js";

export type AgentProfileName = "Mission Director" | "NOVA" | "AURA" | "KEPLER" | "MERCURY";
const reasoningEfforts = ["none", "low", "medium", "high", "xhigh", "max"] as const;
type ReasoningEffort = (typeof reasoningEfforts)[number];
type AgentProfile = { model: string; reasoningEffort: ReasoningEffort };
export type PublicAgentProfile = Pick<AgentProfile, "model" | "reasoningEffort">;

export const DEFAULT_AGENT_MODEL = "gpt-5.6-sol";
export const DEFAULT_REASONING_EFFORT: ReasoningEffort = "medium";

function configuredModel(variable: string, fallback: string) {
  return process.env[variable]?.trim() || fallback;
}

function configuredReasoningEffort(variable: string, fallback: ReasoningEffort): ReasoningEffort {
  const value = process.env[variable]?.trim().toLowerCase();
  return reasoningEfforts.includes(value as ReasoningEffort)
    ? (value as ReasoningEffort)
    : fallback;
}

function profile(prefix: string): AgentProfile {
  return {
    model: configuredModel(prefix + "_MODEL", DEFAULT_AGENT_MODEL),
    reasoningEffort: configuredReasoningEffort(
      prefix + "_REASONING_EFFORT",
      DEFAULT_REASONING_EFFORT
    ),
  };
}

export const agentProfiles: Record<AgentProfileName, AgentProfile> = {
  "Mission Director": profile("MISSION_DIRECTOR"),
  NOVA: profile("NOVA"),
  AURA: profile("AURA"),
  KEPLER: profile("KEPLER"),
  MERCURY: profile("MERCURY"),
};

export const publicAgentProfiles: Record<AgentProfileName, PublicAgentProfile> = Object.fromEntries(
  Object.entries(agentProfiles).map(([name, profile]) => [
    name,
    { model: profile.model, reasoningEffort: profile.reasoningEffort },
  ])
) as Record<AgentProfileName, PublicAgentProfile>;
