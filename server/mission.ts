export type SystemStatus = "nominal" | "watch" | "critical";

export type SystemReading = {
  label: string;
  value: string;
  status: SystemStatus;
  detail: string;
};

export type SpecialistReport = {
  agent: string;
  role: string;
  status: SystemStatus;
  confidence: number;
  recommendation: string;
  evidence: string[];
  tradeoff: string;
};

export type CouncilLog = {
  id: string;
  speaker: string;
  message: string;
  kind: "director" | "evidence" | "assessment";
};

export type MissionState = {
  missionId: string;
  sol: number;
  minutesToStorm: number;
  phase: "alert" | "assessment" | "approval_required" | "executing" | "resolved";
  telemetry: SystemReading[];
  reports: SpecialistReport[];
  councilLog: CouncilLog[];
  timeline: { time: string; event: string; kind: "system" | "agent" | "approval" }[];
  pendingCommand?: { id: string; label: string; consequence: string };
  selectedPlan?: string;
};

const initialTelemetry: SystemReading[] = [
  { label: "Storm front", value: "18 min", status: "critical", detail: "Wind wall accelerating 16% above forecast." },
  { label: "Solar array", value: "31% output", status: "critical", detail: "Dust accumulation is rising." },
  { label: "O₂ recycler", value: "Fault E-17", status: "critical", detail: "CO₂ scrubber loop is oscillating." },
  { label: "Habitat battery", value: "61%", status: "watch", detail: "Enough for one high-load survival window." },
  { label: "EVA crew", value: "1 outside", status: "watch", detail: "Rover is 2.7 km from habitat." }
];

export function createMission(): MissionState {
  return {
    missionId: "ares-7-martian-dust-storm",
    sol: 184,
    minutesToStorm: 18,
    phase: "alert",
    telemetry: structuredClone(initialTelemetry),
    reports: [],
    councilLog: [],
    timeline: [
      { time: "14:02", event: "Ares-7 weather net detects an approaching Martian dust storm.", kind: "system" },
      { time: "14:03", event: "O₂ recycler emits fault E-17. EVA crew remains 2.7 km out.", kind: "system" }
    ]
  };
}

export function specialistReports(state: MissionState): SpecialistReport[] {
  const timePressure = state.minutesToStorm <= 12 ? "Storm arrival is now inside the minimum rover-return window." : "Storm forecast is compressing the available decision window.";
  return [
    {
      agent: "NOVA",
      role: "Power & thermal",
      status: "critical",
      confidence: 0.88,
      recommendation: "Shed greenhouse and lab load now; reserve battery for life support and rover beacon.",
      evidence: ["Solar generation at 31%", "Battery survival window: 7 h 12 m", timePressure],
      tradeoff: "Plant cultures may be lost if the shutdown exceeds four hours."
    },
    {
      agent: "AURA",
      role: "Life support",
      status: "critical",
      confidence: 0.82,
      recommendation: "Isolate the secondary scrubber loop and run the primary loop at 78% capacity.",
      evidence: ["Recycler fault E-17 oscillation", "Cabin reserve: 3 h 40 m if both loops fail"],
      tradeoff: "Isolation reduces redundancy until the storm passes."
    },
    {
      agent: "KEPLER",
      role: "Weather & navigation",
      status: "watch",
      confidence: 0.69,
      recommendation: "Recall the EVA crew on route Bravo and activate rover beacon guidance.",
      evidence: ["Storm front: 18 min", "Rover return estimate: 14 min", "Route Bravo is partially sheltered"],
      tradeoff: "The ground sensor may be dust-contaminated; orbital cross-check is still pending."
    },
    {
      agent: "MERCURY",
      role: "Red-team skeptic",
      status: "watch",
      confidence: 0.77,
      recommendation: "Do not commit to a full habitat shutdown until the orbital weather feed confirms the sensor trend.",
      evidence: ["Single-source weather acceleration", "No corroborating orbital sample yet", "Battery is not yet below emergency threshold"],
      tradeoff: "Waiting two minutes could cost the EVA crew their safe return margin."
    }
  ];
}

export function requestCommand(state: MissionState, plan: string): MissionState {
  const next = structuredClone(state);
  next.phase = "approval_required";
  next.selectedPlan = plan;
  next.pendingCommand = {
    id: "cmd-recall-isolate-shed",
    label: "Recall EVA crew + isolate scrubber + shed nonessential load",
    consequence: "Preserves life support and rover guidance, while risking greenhouse cultures."
  };
  next.timeline.push({ time: "14:05", event: "Mission Director requests commander authorization for the combined survival plan.", kind: "approval" });
  return next;
}

export function approveCommand(state: MissionState, approved: boolean): MissionState {
  const next = structuredClone(state);
  next.pendingCommand = undefined;
  if (!approved) {
    next.phase = "assessment";
    next.timeline.push({ time: "14:06", event: "Commander withheld authorization. Mission Director is recalculating alternatives.", kind: "approval" });
    return next;
  }
  next.phase = "executing";
  next.minutesToStorm = Math.max(0, next.minutesToStorm - 5);
  next.telemetry = next.telemetry.map((reading) => {
    if (reading.label === "EVA crew") return { ...reading, value: "Beacon locked", status: "nominal", detail: "Crew is returning on route Bravo." };
    if (reading.label === "O₂ recycler") return { ...reading, value: "Primary loop 78%", status: "watch", detail: "Secondary loop isolated; cabin trend is stable." };
    if (reading.label === "Habitat battery") return { ...reading, value: "67% projected", status: "nominal", detail: "Greenhouse and lab load shed." };
    return reading;
  });
  next.timeline.push({ time: "14:06", event: "Commander authorized the combined survival plan. EVA beacon, scrubber isolation, and load shedding engaged.", kind: "approval" });
  next.timeline.push({ time: "14:10", event: "Rover guidance confirms crew is 900 m from the airlock. Cabin CO₂ is holding.", kind: "system" });
  return next;
}

export function advanceMission(state: MissionState): MissionState {
  const next = structuredClone(state);
  next.minutesToStorm = Math.max(0, state.minutesToStorm - 4);
  if (next.phase === "executing" && next.minutesToStorm <= 9) {
    next.phase = "resolved";
    next.timeline.push({ time: "14:14", event: "EVA crew crossed the airlock threshold. The Martian dust storm has arrived; the habitat is stable.", kind: "system" });
  } else {
    next.timeline.push({ time: "14:09", event: "Mission clock advanced. Storm arrival now estimated in " + next.minutesToStorm + " minutes.", kind: "system" });
  }
  return next;
}
