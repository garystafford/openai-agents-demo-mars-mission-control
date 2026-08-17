import {
  Agent,
  MemorySession,
  MCPServerStdio,
  run,
  tool,
  type RunState,
  type RunStreamEvent,
  type RunToolApprovalItem,
} from "@openai/agents";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { agentProfiles, type AgentProfileName } from "./agent-profiles.js";
import { MissionUsageCollector } from "./mission-usage.js";
import {
  missionActions,
  normalizePlan,
  type CouncilLog,
  type DecisionPlan,
  type MissionState,
  type SpecialistReport,
} from "./mission.js";

type CouncilActivity = (entry: Omit<CouncilLog, "id">) => void;
type ReportActivity = (report: SpecialistReport) => void;
type MissionDirector = Agent<unknown, typeof decisionPlanSchema>;
type PendingDirectorRun = {
  director: MissionDirector;
  state: RunState<undefined, MissionDirector>;
  approval: RunToolApprovalItem;
  session: MemorySession;
  mcp: MCPServerStdio;
};
const missionSessions = new Map<string, MemorySession>();
const pendingDirectorRuns = new Map<string, PendingDirectorRun>();
const missionUsageCollectors = new Map<string, MissionUsageCollector>();

const specialistAdviceSchema = z.object({
  status: z.enum(["nominal", "watch", "critical"]),
  confidence: z.number().min(0).max(1),
  recommendation: z.string().min(1),
  evidence: z.array(z.string()).min(1).max(4),
  tradeoff: z.string().min(1),
});
const decisionPlanSchema = z.object({
  headline: z.string().min(1),
  actions: z.array(z.enum(missionActions)).min(1).max(4),
  rationale: z.string().min(1),
  uncertainties: z.array(z.string()).max(3),
  approvalScope: z.string().min(1),
});

function missionMcpServer(state: MissionState) {
  const isTypeScriptRuntime = import.meta.url.endsWith(".ts");
  const entry = fileURLToPath(
    new URL("./mission-mcp" + (isTypeScriptRuntime ? ".ts" : ".js"), import.meta.url)
  );
  return new MCPServerStdio({
    name: "Ares-7 Mission Control MCP",
    command: process.execPath,
    args: isTypeScriptRuntime ? ["--import", "tsx", entry] : [entry],
    cwd: process.cwd(),
    env: {
      MISSION_MCP_CONTEXT: JSON.stringify({
        scenario: {
          title: state.scenario.title,
          availableActions: state.scenario.availableActions,
          verification: state.scenario.verification,
        },
        telemetry: state.telemetry,
      }),
    },
    cacheToolsList: true,
  });
}

function planSatisfiesCriticalActions(state: MissionState, plan: DecisionPlan) {
  return state.scenario.requiredActions.every((action) => plan.actions.includes(action));
}

function planSubmissionTool(state: MissionState) {
  return tool({
    name: "submit_mission_plan",
    description:
      "Submit the plan to the commander. The SDK pauses for explicit approval before this tool executes.",
    parameters: decisionPlanSchema,
    needsApproval: true,
    inputGuardrails: [
      {
        name: "required_actions_before_authorization",
        run: async ({ toolCall }) => {
          const candidate = decisionPlanSchema.safeParse(JSON.parse(toolCall.arguments));
          if (!candidate.success || !planSatisfiesCriticalActions(state, candidate.data))
            return {
              behavior: {
                type: "rejectContent" as const,
                message:
                  "Plans submitted for authorization must include every scenario-critical action.",
              },
            };
          return {
            behavior: { type: "allow" as const },
            outputInfo: { criticalActionsCovered: true },
          };
        },
      },
    ],
    execute: async (plan) =>
      JSON.stringify({ status: "authorized_submission", actions: plan.actions }),
  });
}

function planFromInterruption(state: MissionState, interruption: RunToolApprovalItem) {
  if (interruption.name !== "submit_mission_plan" || !interruption.arguments) return undefined;
  return normalizePlan(state, parseStructuredOutput(decisionPlanSchema, interruption.arguments));
}

function recordStreamEvent(event: RunStreamEvent, record: CouncilActivity) {
  if (event.type === "agent_updated_stream_event") {
    record({
      speaker: event.agent.name,
      kind: "sdk",
      message: "SDK activated this agent for the current mission turn.",
    });
    return;
  }
  if (event.type !== "run_item_stream_event" || event.name !== "tool_called") return;
  const speaker =
    "agent" in event.item && event.item.agent ? event.item.agent.name : "Mission Director";
  const raw = event.item.rawItem;
  const toolName = raw && "name" in raw && typeof raw.name === "string" ? raw.name : "tool";
  const message = toolName.startsWith("consult_")
    ? "SDK delegated an evidence task to this specialist."
    : toolName.startsWith("mcp_")
      ? "SDK queried this Mission Control MCP tool."
      : toolName === "submit_mission_plan"
        ? "SDK invoked the commander approval boundary."
        : "SDK invoked " + toolName + ".";
  record({
    speaker,
    kind: "sdk",
    message,
  });
}

function parseStructuredOutput<T>(schema: z.ZodType<T>, output: unknown): T {
  const value = typeof output === "string" ? JSON.parse(output) : output;
  return schema.parse(value);
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
  missionUsageCollectors.delete(missionId);
  const pending = pendingDirectorRuns.get(missionId);
  pendingDirectorRuns.delete(missionId);
  if (pending) void pending.mcp.close().catch(() => undefined);
}

function usageCollectorFor(missionId: string) {
  const existing = missionUsageCollectors.get(missionId);
  if (existing) return existing;
  const collector = new MissionUsageCollector();
  missionUsageCollectors.set(missionId, collector);
  return collector;
}

export function hasPendingMissionApproval(missionId: string) {
  return pendingDirectorRuns.has(missionId);
}

function specialist(
  name: Exclude<AgentProfileName, "Mission Director">,
  specialty: string,
  mcp: MCPServerStdio
) {
  const profile = agentProfiles[name];
  return new Agent({
    name,
    model: profile.model,
    modelSettings: { reasoning: { effort: profile.reasoningEffort }, preserveRawUsage: true },
    outputType: specialistAdviceSchema,
    instructions: [
      "You are " + name + ", the " + specialty + " specialist on Ares-7.",
      "Use the mcp_read_mission_telemetry or mcp_query_mission_protocol tools before advising. Use mcp_request_independent_verification when it would resolve a material uncertainty.",
      "Stay in your domain and state a concise recommendation, evidence, confidence, and one trade-off.",
      "Never claim to execute a command.",
    ].join(" "),
    mcpServers: [mcp],
  });
}

function specialistTool(
  agent: Agent<unknown, typeof specialistAdviceSchema>,
  toolName: string,
  toolDescription: string,
  specialistName: Exclude<AgentProfileName, "Mission Director">,
  specialty: string,
  record: CouncilActivity,
  onReport: ReportActivity,
  usageCollector: MissionUsageCollector
) {
  return agent.asTool({
    toolName,
    toolDescription,
    customOutputExtractor: async (result) => {
      usageCollector.record(result.rawResponses, agentProfiles[specialistName].model);
      const advice = parseStructuredOutput(specialistAdviceSchema, result.finalOutput);
      const report: SpecialistReport = { agent: specialistName, role: specialty, ...advice };
      onReport(report);
      const recommendation =
        advice.recommendation.length > 150
          ? advice.recommendation.slice(0, 147).trimEnd() + "…"
          : advice.recommendation;
      record({
        speaker: specialistName,
        kind: "assessment",
        message: "Recommendation: " + recommendation,
      });
      return JSON.stringify(advice);
    },
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
  const recordReport: ReportActivity = (report) => {
    reports.push(report);
    onReport?.(report);
  };
  record({
    speaker: "Mission Director",
    kind: "director",
    message: reviewRequest
      ? "Received the commander’s review request and is reassessing the proposal."
      : "Started an adaptive investigation and will consult only the specialists needed to reduce risk.",
  });
  if (!process.env.OPENAI_API_KEY) {
    record({
      speaker: "Mission Director",
      kind: "director",
      message: "Could not establish a mission-team link. The command channel needs its API key.",
    });
    return { log, reports, plan: undefined };
  }

  const session = sessionFor(state);
  const usageCollector = usageCollectorFor(state.missionId);
  const mcp = missionMcpServer(state);
  await mcp.connect();
  const power = specialist("NOVA", "Power & thermal", mcp);
  const lifeSupport = specialist("AURA", "Life-support", mcp);
  const weather = specialist("KEPLER", "Weather & navigation", mcp);
  const redTeam = specialist("MERCURY", "Red-team risk", mcp);
  const director = new Agent({
    name: "Mission Director",
    model: agentProfiles["Mission Director"].model,
    modelSettings: {
      reasoning: { effort: agentProfiles["Mission Director"].reasoningEffort },
      preserveRawUsage: true,
    },
    outputType: decisionPlanSchema,
    outputGuardrails: [
      {
        name: "final_plan_preserves_critical_actions",
        execute: async ({ agentOutput }) => {
          const candidate = decisionPlanSchema.safeParse(agentOutput);
          const covered = candidate.success && planSatisfiesCriticalActions(state, candidate.data);
          return { tripwireTriggered: !covered, outputInfo: { criticalActionsCovered: covered } };
        },
      },
    ],
    instructions: [
      "You are the Ares-7 Mission Director. Form an adaptive, evidence-based response to the incident.",
      "Choose the specialist tools that materially reduce uncertainty; do not call every specialist by default. Call MERCURY when an assumption, conflict, or unsafe trade-off needs challenge.",
      "When the commander requests a review, address that request directly. Retain a sound plan when evidence supports it, or revise it when new evidence or the requested challenge warrants a change.",
      "Synthesize the evidence into a plan with only actions from the available-action list. A plan requests authorization; it never executes commands.",
      "Before returning the required structured decision plan, call submit_mission_plan with that exact plan. The SDK pauses at that tool for commander approval.",
    ].join(" "),
    tools: [
      specialistTool(
        power,
        "consult_power",
        "Ask NOVA to analyze power and thermal risk.",
        "NOVA",
        "Power & thermal",
        record,
        recordReport,
        usageCollector
      ),
      specialistTool(
        lifeSupport,
        "consult_life_support",
        "Ask AURA to analyze breathable-cabin and scrubber risk.",
        "AURA",
        "Life-support",
        record,
        recordReport,
        usageCollector
      ),
      specialistTool(
        weather,
        "consult_weather",
        "Ask KEPLER to analyze weather, navigation, and crew-location risk.",
        "KEPLER",
        "Weather & navigation",
        record,
        recordReport,
        usageCollector
      ),
      specialistTool(
        redTeam,
        "consult_red_team",
        "Ask MERCURY to challenge assumptions, evidence gaps, and unsafe trade-offs.",
        "MERCURY",
        "Red-team risk",
        record,
        recordReport,
        usageCollector
      ),
      planSubmissionTool(state),
    ],
  });
  const input = [
    "Incident: " + state.scenario.title + ".",
    state.scenario.briefing,
    "Active risks: " + state.scenario.activeRisks.join("; ") + ".",
    "Available actions: " + state.scenario.availableActions.join(", ") + ".",
    "Current telemetry: " + JSON.stringify(state.telemetry),
    ...(reviewRequest
      ? [
          "Commander review request: " + reviewRequest,
          "Current draft plan: " + JSON.stringify(previousPlan ?? {}),
        ]
      : []),
  ].join(" ");
  try {
    const result = await run(director, input, {
      session,
      stream: true,
      toolExecution: { preApprovalInputGuardrails: true },
    });
    for await (const event of result) recordStreamEvent(event, record);
    usageCollector.record(result.rawResponses, agentProfiles["Mission Director"].model);
    const interruption = result.interruptions.find((item) => item.name === "submit_mission_plan");
    if (interruption) {
      const plan = planFromInterruption(state, interruption);
      if (!plan) {
        await mcp.close();
        throw new Error("The SDK approval request did not include a valid mission plan.");
      }
      pendingDirectorRuns.set(state.missionId, {
        director,
        state: result.state,
        approval: interruption,
        session,
        mcp,
      });
      record({
        speaker: "Mission Director",
        kind: "sdk",
        message:
          "SDK paused the run for explicit commander approval. No mission action has executed.",
      });
      return { log, reports, plan, awaitingApproval: true, usage: usageCollector.summary() };
    }
    const plan = normalizePlan(
      state,
      parseStructuredOutput(decisionPlanSchema, result.finalOutput) as DecisionPlan
    );
    record({
      speaker: "Mission Director",
      kind: "director",
      message:
        "Reconciled the evidence and prepared an approval-ready response" +
        (reports.length
          ? " after consulting " + reports.map((report) => report.agent).join(", ")
          : "") +
        ".",
    });
    await mcp.close();
    return { log, reports, plan, awaitingApproval: false, usage: usageCollector.summary() };
  } catch (error) {
    await mcp.close().catch(() => undefined);
    throw error;
  }
}

export async function resolveMissionApproval(state: MissionState, approved: boolean) {
  const pending = pendingDirectorRuns.get(state.missionId);
  if (!pending) throw new Error("No SDK approval interruption is available for this mission.");
  if (approved) pending.state.approve(pending.approval);
  else
    pending.state.reject(pending.approval, {
      message: "The commander declined the proposed mission actions. Do not execute them.",
    });

  const result = await run(pending.director, pending.state, {
    session: pending.session,
    stream: true,
    toolExecution: { preApprovalInputGuardrails: true },
  });
  for await (const event of result) {
    // The initial turn already streamed the observable delegation path to the UI.
    void event;
  }
  const usageCollector = usageCollectorFor(state.missionId);
  usageCollector.record(result.rawResponses, agentProfiles["Mission Director"].model);
  const interruption = result.interruptions.find((item) => item.name === "submit_mission_plan");
  if (interruption) {
    const plan = planFromInterruption(state, interruption);
    if (!plan) throw new Error("The resumed SDK run did not include a valid mission plan.");
    pendingDirectorRuns.set(state.missionId, {
      ...pending,
      state: result.state,
      approval: interruption,
    });
    return { plan, awaitingApproval: true, usage: usageCollector.summary() };
  }
  pendingDirectorRuns.delete(state.missionId);
  await pending.mcp.close();
  return {
    plan: result.finalOutput
      ? normalizePlan(
          state,
          parseStructuredOutput(decisionPlanSchema, result.finalOutput) as DecisionPlan
        )
      : undefined,
    awaitingApproval: false,
    usage: usageCollector.summary(),
  };
}
