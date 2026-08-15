import { Agent, MemorySession, run, tool } from "@openai/agents";
import { z } from "zod";
import type { CouncilLog, MissionState } from "./mission.js";

const missionSession = new MemorySession({ sessionId: "ares-7-command-session" });

type CouncilActivity = (entry: Omit<CouncilLog, "id">) => void;

function createTelemetryTool(state: MissionState, speaker: string, record: CouncilActivity) {
  return tool({
    name: "read_mission_telemetry",
    description: "Read current Ares-7 telemetry. Use this before making a recommendation.",
    parameters: z.object({
      system: z.string().describe("The named system to inspect, or 'all' for all readings.")
    }),
    async execute({ system }) {
      record({
        speaker,
        kind: "evidence",
        message: "Retrieved " + (system.toLowerCase() === "all" ? "the full mission telemetry set" : system + " telemetry") + "."
      });
      const readings = system.toLowerCase() === "all"
        ? state.telemetry
        : state.telemetry.filter((item) => item.label.toLowerCase().includes(system.toLowerCase()));
      return JSON.stringify(readings.length ? readings : state.telemetry);
    }
  });
}

function createProtocolTool(speaker: string, record: CouncilActivity) {
  return tool({
    name: "query_mission_protocol",
    description: "Look up a mission safety protocol by topic.",
    parameters: z.object({ topic: z.string() }),
    async execute({ topic }) {
      record({ speaker, kind: "evidence", message: "Consulted the " + topic + " safety protocol." });
      const protocol = topic.toLowerCase().includes("eva")
        ? "EVA recall protocol: activate rover beacon when storm ETA is under 20 minutes; prioritise crew return over non-critical research assets."
        : "Life-support contingency protocol: preserve a stable breathable-cabin loop before nonessential power loads; retain one independent verification source for weather-triggered shutdowns.";
      return protocol;
    }
  });
}

function specialist(name: string, specialty: string, state: MissionState, record: CouncilActivity) {
  return new Agent({
    name,
    instructions: [
      "You are " + name + ", the " + specialty + " specialist on Ares-7.",
      "Use both the telemetry and mission-protocol tools before advising.",
      "Return a concise recommendation with evidence, confidence, and one explicit trade-off.",
      "Never claim to execute a command."
    ].join(" "),
    tools: [createTelemetryTool(state, name, record), createProtocolTool(name, record)]
  });
}

function councilTool(
  agent: Agent,
  toolName: string,
  toolDescription: string,
  specialistName: string,
  record: CouncilActivity
) {
  return agent.asTool({
    toolName,
    toolDescription,
    onStream: ({ event }) => {
      if (event.type === "run_item_stream_event" && event.name === "tool_called") {
        record({ speaker: specialistName, kind: "evidence", message: "Opened a mission evidence request." });
      }
    },
    customOutputExtractor: async (result) => {
      record({ speaker: specialistName, kind: "assessment", message: "Submitted an assessment to the Mission Director." });
      return String(result.finalOutput);
    }
  });
}

export async function runMissionDirector(state: MissionState, onActivity?: (entry: CouncilLog) => void) {
  const log: CouncilLog[] = [];
  const record: CouncilActivity = (entry) => {
    const item = { id: "council-" + (log.length + 1), ...entry };
    log.push(item);
    onActivity?.(item);
  };

  record({ speaker: "Mission Director", kind: "director", message: "Asked NOVA, AURA, KEPLER, and MERCURY for an emergency assessment." });

  if (!process.env.OPENAI_API_KEY) {
    record({ speaker: "Mission Director", kind: "director", message: "Could not establish a mission-team link. The command channel needs its API key." });
    return { brief: "The mission team is unavailable because the command channel has no API key.", log };
  }

  const power = specialist("NOVA", "Power & thermal", state, record);
  const lifeSupport = specialist("AURA", "Life-support", state, record);
  const weather = specialist("KEPLER", "Weather & navigation", state, record);
  const redTeam = specialist("MERCURY", "Red-team risk", state, record);

  const director = new Agent({
    name: "Mission Director",
    instructions: [
      "You are the Ares-7 Mission Director. You retain command of the conversation.",
      "You must consult all four specialists for their distinct domains, reconcile conflicts, and prepare a decision brief.",
      "Your brief must include: recommended plan, immediate sequence, unresolved uncertainty, and a single approval request.",
      "You cannot execute commands; you can only request commander approval."
    ].join(" "),
    tools: [
      councilTool(power, "consult_power", "Ask NOVA to analyze power and thermal risk.", "NOVA", record),
      councilTool(lifeSupport, "consult_life_support", "Ask AURA to analyze breathable-cabin and scrubber risk.", "AURA", record),
      councilTool(weather, "consult_weather", "Ask KEPLER to analyze storm timing and EVA return.", "KEPLER", record),
      councilTool(redTeam, "consult_red_team", "Ask MERCURY to challenge assumptions and identify unsafe evidence gaps.", "MERCURY", record)
    ]
  });

  const input = [
    "An Ares-7 dust storm reaches the habitat in " + state.minutesToStorm + " minutes.",
    "The oxygen recycler is faulting, solar power is failing, and one crew member is outside.",
    "Produce the mission decision brief now."
  ].join(" ");

  const result = await run(director, input, { session: missionSession });
  record({ speaker: "Mission Director", kind: "director", message: "Reconciled the team’s evidence and prepared a command recommendation." });
  return { brief: String(result.finalOutput), log };
}
