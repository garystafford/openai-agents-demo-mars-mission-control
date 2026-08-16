import { Agent, MemorySession, run, tool } from "@openai/agents";
import { z } from "zod";
import { agentProfiles, type AgentProfileName } from "./agent-profiles.js";
import { missionActions, normalizePlan, type CouncilLog, type DecisionPlan, type MissionState, type SpecialistReport } from "./mission.js";

type CouncilActivity = (entry: Omit<CouncilLog, "id">) => void;
type ReportActivity = (report: SpecialistReport) => void;
const missionSessions = new Map<string, MemorySession>();

const specialistAdviceSchema = z.object({
  status: z.enum(["nominal", "watch", "critical"]),
  confidence: z.number().min(0).max(1),
  recommendation: z.string().min(1),
  evidence: z.array(z.string()).min(1).max(4),
  tradeoff: z.string().min(1)
});
const decisionPlanSchema = z.object({
  headline: z.string().min(1),
  actions: z.array(z.enum(missionActions)).min(1).max(4),
  rationale: z.string().min(1),
  uncertainties: z.array(z.string()).max(3),
  approvalScope: z.string().min(1)
});

function parseStructuredOutput<T>(schema: z.ZodType<T>, output: unknown): T {
  const value = typeof output === "string" ? JSON.parse(output) : output;
  return schema.parse(value);
}

function createTelemetryTool(state: MissionState, speaker: string, record: CouncilActivity) {
  return tool({
    name: "read_mission_telemetry",
    description: "Read current Ares-7 telemetry. Use this before making a recommendation.",
    parameters: z.object({ system: z.string().describe("A named system, or 'all' for all readings.") }),
    async execute({ system }) {
      const readings = system.toLowerCase() === "all" ? state.telemetry : state.telemetry.filter((item) => item.label.toLowerCase().includes(system.toLowerCase()));
      const resolved = readings.length ? readings : state.telemetry;
      const label = resolved.length === state.telemetry.length ? "the full telemetry set" : resolved.map((reading) => reading.label).join(" and ");
      record({ speaker, kind: "evidence", message: "Checked " + label + "." });
      return JSON.stringify(resolved);
    }
  });
}

function createProtocolTool(state: MissionState, speaker: string, record: CouncilActivity) {
  return tool({
    name: "query_mission_protocol",
    description: "Look up a mission safety protocol by topic.",
    parameters: z.object({ topic: z.string() }),
    async execute({ topic }) {
      record({ speaker, kind: "evidence", message: "Reviewed the " + topic + " safety procedure." });
      return ["Scenario: " + state.scenario.title + ".", "Protocol principle: protect crew and life-critical capability before research or convenience loads.", "Available actions: " + state.scenario.availableActions.join(", ") + ".", "Requested topic: " + topic + "."].join(" ");
    }
  });
}

function createVerificationTool(state: MissionState, speaker: string, record: CouncilActivity) {
  return tool({
    name: "request_independent_verification",
    description: "Obtain an independent observation from orbital, maintenance, or crew sources when evidence is incomplete or conflicting.",
    parameters: z.object({ source: z.enum(["orbital", "maintenance", "crew"]) }),
    async execute({ source }) {
      const finding = state.scenario.verification[source];
      record({ speaker, kind: "evidence", message: "Cross-checked the " + source + " report: " + finding });
      return finding;
    }
  });
}

function sessionFor(state: MissionState) {
  const existing = missionSessions.get(state.missionId);
  if (existing) return existing;
  const session = new MemorySession({ sessionId: state.missionId + "-incident" });
  missionSessions.set(state.missionId, session);
  return session;
}

export function clearMissionSession(missionId: string) {
  missionSessions.delete(missionId);
}

function specialist(name: Exclude<AgentProfileName, "Mission Director">, specialty: string, state: MissionState, record: CouncilActivity) {
  const profile = agentProfiles[name];
  return new Agent({
    name,
    model: profile.model,
    modelSettings: { reasoning: { effort: profile.reasoningEffort } },
    outputType: specialistAdviceSchema,
    instructions: [
      "You are " + name + ", the " + specialty + " specialist on Ares-7.",
      "Use telemetry and protocol evidence before advising. Request independent verification when it would resolve a material uncertainty.",
      "Stay in your domain and state a concise recommendation, evidence, confidence, and one trade-off.",
      "Never claim to execute a command."
    ].join(" "),
    tools: [createTelemetryTool(state, name, record), createProtocolTool(state, name, record), createVerificationTool(state, name, record)]
  });
}

function specialistTool(agent: Agent<any, any>, toolName: string, toolDescription: string, specialistName: string, specialty: string, record: CouncilActivity, onReport: ReportActivity) {
  return agent.asTool({
    toolName,
    toolDescription,
    customOutputExtractor: async (result) => {
      const advice = parseStructuredOutput(specialistAdviceSchema, result.finalOutput);
      const report: SpecialistReport = { agent: specialistName, role: specialty, ...advice };
      onReport(report);
      const recommendation = advice.recommendation.length > 150 ? advice.recommendation.slice(0, 147).trimEnd() + "…" : advice.recommendation;
      record({ speaker: specialistName, kind: "assessment", message: "Recommendation: " + recommendation });
      return JSON.stringify(advice);
    }
  });
}

export async function runMissionDirector(
  state: MissionState,
  onActivity?: (entry: CouncilLog) => void,
  onReport?: ReportActivity,
  reviewRequest?: string,
  previousPlan?: DecisionPlan
) {
  const log: CouncilLog[] = [];
  const reports: SpecialistReport[] = [];
  const record: CouncilActivity = (entry) => {
    const item = { id: "council-" + (log.length + 1), ...entry };
    log.push(item);
    onActivity?.(item);
  };
  const recordReport: ReportActivity = (report) => { reports.push(report); onReport?.(report); };
  record({ speaker: "Mission Director", kind: "director", message: reviewRequest ? "Received the commander’s review request and is reassessing the proposal." : "Started an adaptive investigation and will consult only the specialists needed to reduce risk." });
  if (!process.env.OPENAI_API_KEY) {
    record({ speaker: "Mission Director", kind: "director", message: "Could not establish a mission-team link. The command channel needs its API key." });
    return { log, reports, plan: undefined };
  }

  const power = specialist("NOVA", "Power & thermal", state, record);
  const lifeSupport = specialist("AURA", "Life-support", state, record);
  const weather = specialist("KEPLER", "Weather & navigation", state, record);
  const redTeam = specialist("MERCURY", "Red-team risk", state, record);
  const director = new Agent({
    name: "Mission Director",
    model: agentProfiles["Mission Director"].model,
    modelSettings: { reasoning: { effort: agentProfiles["Mission Director"].reasoningEffort } },
    outputType: decisionPlanSchema,
    instructions: [
      "You are the Ares-7 Mission Director. Form an adaptive, evidence-based response to the incident.",
      "Choose the specialist tools that materially reduce uncertainty; do not call every specialist by default. Call MERCURY when an assumption, conflict, or unsafe trade-off needs challenge.",
      "When the commander requests a review, address that request directly. Retain a sound plan when evidence supports it, or revise it when new evidence or the requested challenge warrants a change.",
      "Synthesize the evidence into a plan with only actions from the available-action list. A plan requests authorization; it never executes commands.",
      "Return the required structured decision plan, including remaining uncertainty and one clear approval scope."
    ].join(" "),
    tools: [
      specialistTool(power, "consult_power", "Ask NOVA to analyze power and thermal risk.", "NOVA", "Power & thermal", record, recordReport),
      specialistTool(lifeSupport, "consult_life_support", "Ask AURA to analyze breathable-cabin and scrubber risk.", "AURA", "Life-support", record, recordReport),
      specialistTool(weather, "consult_weather", "Ask KEPLER to analyze weather, navigation, and crew-location risk.", "KEPLER", "Weather & navigation", record, recordReport),
      specialistTool(redTeam, "consult_red_team", "Ask MERCURY to challenge assumptions, evidence gaps, and unsafe trade-offs.", "MERCURY", "Red-team risk", record, recordReport)
    ]
  });
  const input = [
    "Incident: " + state.scenario.title + ".", state.scenario.briefing,
    "Active risks: " + state.scenario.activeRisks.join("; ") + ".",
    "Available actions: " + state.scenario.availableActions.join(", ") + ".",
    "Current telemetry: " + JSON.stringify(state.telemetry),
    ...(reviewRequest ? ["Commander review request: " + reviewRequest, "Current draft plan: " + JSON.stringify(previousPlan ?? {})] : [])
  ].join(" ");
  const result = await run(director, input, { session: sessionFor(state) });
  const plan = normalizePlan(state, parseStructuredOutput(decisionPlanSchema, result.finalOutput) as DecisionPlan);
  record({ speaker: "Mission Director", kind: "director", message: "Reconciled the evidence and prepared an approval-ready response" + (reports.length ? " after consulting " + reports.map((report) => report.agent).join(", ") : "") + "." });
  return { log, reports, plan };
}
