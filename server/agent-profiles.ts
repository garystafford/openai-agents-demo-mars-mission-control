import "./env.js";

export type AgentProfileName = "Mission Director" | "NOVA" | "AURA" | "KEPLER" | "MERCURY";
const reasoningEfforts = ["none", "low", "medium", "high", "xhigh", "max"] as const;
type ReasoningEffort = (typeof reasoningEfforts)[number];
type AgentProfile = { model: string; reasoningEffort: ReasoningEffort };
export type PublicAgentProfile = Pick<AgentProfile, "model" | "reasoningEffort">;

function configuredModel(variable: string, fallback: string) {
  return process.env[variable]?.trim() || fallback;
}

function configuredReasoningEffort(variable: string, fallback: ReasoningEffort): ReasoningEffort {
  const value = process.env[variable]?.trim().toLowerCase();
  return reasoningEfforts.includes(value as ReasoningEffort) ? value as ReasoningEffort : fallback;
}

function profile(prefix: string, fallback: AgentProfile): AgentProfile {
  return {
    model: configuredModel(prefix + "_MODEL", fallback.model),
    reasoningEffort: configuredReasoningEffort(prefix + "_REASONING_EFFORT", fallback.reasoningEffort)
  };
}

export const agentProfiles: Record<AgentProfileName, AgentProfile> = {
  "Mission Director": profile("MISSION_DIRECTOR", { model: "gpt-5.6-sol", reasoningEffort: "high" }),
  NOVA: profile("NOVA", { model: "gpt-5.6-terra", reasoningEffort: "medium" }),
  AURA: profile("AURA", { model: "gpt-5.6-terra", reasoningEffort: "medium" }),
  KEPLER: profile("KEPLER", { model: "gpt-5.6-luna", reasoningEffort: "low" }),
  MERCURY: profile("MERCURY", { model: "gpt-5.6-sol", reasoningEffort: "high" })
};

export const publicAgentProfiles: Record<AgentProfileName, PublicAgentProfile> = Object.fromEntries(
  Object.entries(agentProfiles).map(([name, profile]) => [name, { model: profile.model, reasoningEffort: profile.reasoningEffort }])
) as Record<AgentProfileName, PublicAgentProfile>;
