export type SystemStatus = "nominal" | "watch" | "critical";

export type SystemReading = {
  label: string;
  value: string;
  status: SystemStatus;
  detail: string;
};

export const missionActions = [
  "recall_eva",
  "shed_nonessential_load",
  "isolate_scrubber",
  "verify_orbital_weather",
  "deploy_repair_drone",
  "switch_to_backup_relay"
] as const;

export type MissionAction = (typeof missionActions)[number];

export const actionLabels: Record<MissionAction, string> = {
  recall_eva: "Recall EVA crew and activate rover guidance",
  shed_nonessential_load: "Shed greenhouse and laboratory power",
  isolate_scrubber: "Isolate the unstable scrubber loop",
  verify_orbital_weather: "Request an orbital weather cross-check",
  deploy_repair_drone: "Deploy the exterior repair drone",
  switch_to_backup_relay: "Switch to the backup communications relay"
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

export type DecisionPlan = {
  headline: string;
  actions: MissionAction[];
  rationale: string;
  uncertainties: string[];
  approvalScope: string;
};

export type IncidentScenario = {
  id: "dust_storm" | "coolant_leak" | "relay_failure";
  title: string;
  briefing: string;
  activeRisks: string[];
  verification: Record<string, string>;
  requiredActions: MissionAction[];
  availableActions: MissionAction[];
  telemetry: SystemReading[];
};

export type MissionState = {
  missionId: string;
  sol: number;
  minutesToImpact: number;
  monitoringIntervals: number;
  phase: "alert" | "assessment" | "approval_required" | "executing" | "resolved";
  scenario: IncidentScenario;
  telemetry: SystemReading[];
  reports: SpecialistReport[];
  councilLog: CouncilLog[];
  timeline: { time: string; event: string; kind: "system" | "agent" | "approval" }[];
  pendingCommand?: { id: string; label: string; consequence: string };
  selectedPlan?: DecisionPlan;
  outcome?: "stabilized" | "degraded";
};

export const scenarioIds: IncidentScenario["id"][] = ["dust_storm", "coolant_leak", "relay_failure"];

const scenarios: Record<IncidentScenario["id"], IncidentScenario> = {
  dust_storm: {
    id: "dust_storm",
    title: "Approaching Martian Dust Storm",
    briefing: "A dust storm reaches Ares-7 in 18 minutes. One EVA crew member is outside while solar output is collapsing and the oxygen recycler is unstable.",
    activeRisks: ["Crew is outside", "Breathable cabin loop is unstable", "Solar power is degrading"],
    verification: {
      orbital: "Orbital weather cross-check: storm acceleration is real, but the densest gust front may arrive 3 minutes later than the ground sensor predicts.",
      maintenance: "Maintenance review: the secondary scrubber loop can be isolated without damaging the primary loop.",
      crew: "EVA crew report: rover is operational and route Bravo remains passable for approximately 14 minutes."
    },
    requiredActions: ["recall_eva", "isolate_scrubber", "shed_nonessential_load"],
    availableActions: ["recall_eva", "shed_nonessential_load", "isolate_scrubber", "verify_orbital_weather", "deploy_repair_drone"],
    telemetry: [
      { label: "Storm front", value: "18 min", status: "critical", detail: "Wind wall accelerating 16% above forecast." },
      { label: "Solar array", value: "31% output", status: "critical", detail: "Dust accumulation is rising." },
      { label: "O₂ recycler", value: "Fault E-17", status: "critical", detail: "CO₂ scrubber loop is oscillating." },
      { label: "Habitat battery", value: "61%", status: "watch", detail: "Enough for one high-load survival window." },
      { label: "EVA crew", value: "1 outside", status: "watch", detail: "Rover is 2.7 km from habitat." }
    ]
  },
  coolant_leak: {
    id: "coolant_leak",
    title: "Habitat Coolant Leak",
    briefing: "A coolant leak is spreading through the thermal loop. The habitat is warm, a repair drone is available, and the crew is inside—but isolating the loop may black out communications.",
    activeRisks: ["Thermal loop pressure is falling", "Cabin heat is rising", "Repair may interrupt communications"],
    verification: {
      orbital: "Orbital thermal image: the exterior radiator is intact; the leak likely originates in the habitat service bay.",
      maintenance: "Maintenance review: the repair drone can seal the service-bay line, but deployment draws a high transient power load.",
      crew: "Crew report: service bay is clear, but manual repair would expose a crew member to a hot-surface hazard."
    },
    requiredActions: ["deploy_repair_drone", "shed_nonessential_load"],
    availableActions: ["shed_nonessential_load", "deploy_repair_drone", "switch_to_backup_relay", "verify_orbital_weather"],
    telemetry: [
      { label: "Thermal loop", value: "42% pressure", status: "critical", detail: "Coolant loss is accelerating in the service bay." },
      { label: "Cabin temperature", value: "27.8°C", status: "watch", detail: "Rising 0.7°C every 6 minutes." },
      { label: "Repair drone", value: "Ready", status: "nominal", detail: "Sealant cartridge and diagnostic arm are available." },
      { label: "Habitat battery", value: "54%", status: "watch", detail: "Drone deployment requires a temporary high-load window." },
      { label: "Comms relay", value: "Primary online", status: "watch", detail: "Thermal-loop isolation could interrupt the primary relay." }
    ]
  },
  relay_failure: {
    id: "relay_failure",
    title: "Orbital Relay Failure",
    briefing: "The primary orbital relay has failed during a worsening dust storm. A science traverse is beyond line of sight, the backup relay is available, and power reserve is limited.",
    activeRisks: ["Traverse crew is beyond line of sight", "Primary communications relay is down", "Backup relay draws from a limited battery"],
    verification: {
      orbital: "Orbital diagnostic: the relay fault is localized to the primary antenna controller; no solar flare is present.",
      maintenance: "Maintenance review: the backup relay will provide voice and low-rate telemetry but consumes 9% battery per hour.",
      crew: "Traverse crew beacon: automatic position pings remain available, but two-way voice contact is not restored."
    },
    requiredActions: ["switch_to_backup_relay"],
    availableActions: ["switch_to_backup_relay", "shed_nonessential_load", "verify_orbital_weather", "recall_eva"],
    telemetry: [
      { label: "Primary relay", value: "Offline", status: "critical", detail: "Antenna controller is not responding." },
      { label: "Traverse crew", value: "2 beyond line of sight", status: "critical", detail: "Automatic beacon only; no voice confirmation." },
      { label: "Backup relay", value: "Standby", status: "watch", detail: "Low-rate voice and telemetry available at high battery cost." },
      { label: "Habitat battery", value: "48%", status: "watch", detail: "Dust cover limits solar recharge for the next 6 hours." },
      { label: "Storm front", value: "31 min", status: "watch", detail: "Visibility is expected to worsen on the traverse route." }
    ]
  }
};

export function createMission(scenarioId: IncidentScenario["id"] = "dust_storm"): MissionState {
  const scenario = structuredClone(scenarios[scenarioId]);
  return {
    missionId: "ares-7-" + scenario.id,
    sol: 184,
    minutesToImpact: scenario.id === "coolant_leak" ? 24 : scenario.id === "relay_failure" ? 31 : 18,
    monitoringIntervals: 0,
    phase: "alert",
    scenario,
    telemetry: structuredClone(scenario.telemetry),
    reports: [],
    councilLog: [],
    timeline: [
      { time: "14:02", event: "Ares-7 detects: " + scenario.title + ".", kind: "system" },
      { time: "14:03", event: scenario.briefing, kind: "system" }
    ]
  };
}

export function specialistReports(_state: MissionState): SpecialistReport[] {
  return [];
}

export function normalizePlan(state: MissionState, input: Partial<DecisionPlan>): DecisionPlan {
  const actions = (input.actions ?? []).filter((action): action is MissionAction => state.scenario.availableActions.includes(action as MissionAction));
  return {
    headline: input.headline?.trim() || "Investigate and stabilize the incident",
    actions: actions.length > 0 ? [...new Set(actions)] : [state.scenario.availableActions[0]],
    rationale: input.rationale?.trim() || "The Director requires additional evidence before expanding the response.",
    uncertainties: (input.uncertainties ?? []).filter(Boolean).slice(0, 3),
    approvalScope: input.approvalScope?.trim() || "Authorize the selected stabilizing actions."
  };
}

export function requestCommand(state: MissionState, planInput: Partial<DecisionPlan>): MissionState {
  const next = structuredClone(state);
  const plan = normalizePlan(next, planInput);
  next.phase = "approval_required";
  next.selectedPlan = plan;
  next.pendingCommand = {
    id: "cmd-" + plan.actions.join("-"),
    label: plan.actions.map((action) => actionLabels[action]).join(" + "),
    consequence: plan.approvalScope
  };
  next.timeline.push({ time: "14:05", event: "Mission Director requests commander authorization for: " + plan.actions.map((action) => actionLabels[action]).join("; ") + ".", kind: "approval" });
  return next;
}

export function approveCommand(state: MissionState, approved: boolean): MissionState {
  const next = structuredClone(state);
  const plan = next.selectedPlan;
  next.pendingCommand = undefined;
  if (!approved) {
    next.phase = "assessment";
    next.timeline.push({ time: "14:06", event: "Commander withheld authorization. The Mission Director must investigate an alternative.", kind: "approval" });
    return next;
  }

  const actions = plan?.actions ?? [];
  next.phase = "executing";
  next.monitoringIntervals = 0;
  const complete = state.scenario.requiredActions.every((action) => actions.includes(action));
  next.outcome = complete ? "stabilized" : "degraded";
  next.timeline.push({ time: "14:06", event: "Commander authorized: " + actions.map((action) => actionLabels[action]).join("; ") + ".", kind: "approval" });
  next.timeline.push({ time: "14:06", event: "Actions dispatched. Mission Control is monitoring their effect before confirming the outcome.", kind: "system" });
  return next;
}

export function advanceMission(state: MissionState): MissionState {
  const next = structuredClone(state);
  if (next.phase !== "executing") return next;

  next.minutesToImpact = Math.max(0, state.minutesToImpact - 4);
  next.monitoringIntervals = state.monitoringIntervals + 1;
  const actions = next.selectedPlan?.actions ?? [];
  const interval = next.monitoringIntervals;
  next.telemetry = next.telemetry.map((reading) => {
    if (reading.label === "EVA crew" && actions.includes("recall_eva")) {
      if (interval === 1) return { ...reading, value: "Return route acquired", status: "watch", detail: "Rover guidance is leading the crew onto route Bravo." };
      if (interval === 2) return { ...reading, value: "1.2 km from habitat", status: "watch", detail: "Crew has cleared the exposed ridge and is approaching the airlock." };
      return { ...reading, value: "Airlock secured", status: "nominal", detail: "Crew is safely inside the habitat." };
    }
    if (reading.label === "Traverse crew" && actions.includes("switch_to_backup_relay")) {
      if (interval === 1) return { ...reading, value: "Beacon confirmed", status: "watch", detail: "Backup relay is acquiring the traverse signal." };
      if (interval === 2) return { ...reading, value: "Voice link active", status: "watch", detail: "Crew has acknowledged the restored communications path." };
      return { ...reading, value: "Voice link stable", status: "nominal", detail: "Backup relay now carries voice and low-rate telemetry." };
    }
    if (reading.label === "O₂ recycler" && actions.includes("isolate_scrubber")) {
      if (interval === 1) return { ...reading, value: "Loop isolating", status: "critical", detail: "The unstable secondary scrubber is being taken offline." };
      if (interval === 2) return { ...reading, value: "Primary loop stable", status: "watch", detail: "Cabin gas trend has stopped worsening." };
      return { ...reading, value: "Primary loop nominal", status: "nominal", detail: "The isolated loop is no longer affecting cabin air processing." };
    }
    if (reading.label === "Thermal loop" && actions.includes("deploy_repair_drone")) {
      if (interval === 1) return { ...reading, value: "Drone outbound", status: "critical", detail: "Repair drone is moving toward the service-bay breach." };
      if (interval === 2) return { ...reading, value: "Seal in progress", status: "watch", detail: "Sealant is being applied while pressure loss slows." };
      return { ...reading, value: "78% pressure", status: "nominal", detail: "Pressure is recovering after the service-bay seal." };
    }
    if (reading.label === "Repair drone" && actions.includes("deploy_repair_drone")) {
      if (interval === 1) return { ...reading, value: "En route", status: "watch", detail: "Diagnostic arm and sealant cartridge are active." };
      if (interval === 2) return { ...reading, value: "Applying sealant", status: "watch", detail: "The drone is sealing the service-bay line." };
      return { ...reading, value: "Seal verified", status: "nominal", detail: "The drone has completed the pressure verification pass." };
    }
    if (reading.label === "Habitat battery" && actions.includes("shed_nonessential_load")) {
      if (interval === 1) return { ...reading, value: "Load shedding active", status: "watch", detail: "Greenhouse and laboratory systems are powering down." };
      if (interval === 2) return { ...reading, value: "Reserve protected", status: "watch", detail: "Nonessential load is offline and the reserve is holding." };
      return { ...reading, value: "Reserve stable", status: "nominal", detail: "The protected reserve can support the required response." };
    }
    if ((reading.label === "Backup relay" || reading.label === "Comms relay") && actions.includes("switch_to_backup_relay")) {
      if (interval === 1) return { ...reading, value: "Booting", status: "watch", detail: "The backup communications path is coming online." };
      if (interval === 2) return { ...reading, value: "Voice link active", status: "watch", detail: "Low-rate voice and telemetry are being routed through backup." };
      return { ...reading, value: "Online", status: "nominal", detail: "Backup communications are stable for the current response." };
    }
    return reading;
  });
  if (next.monitoringIntervals >= 3) {
    next.phase = "resolved";
    next.timeline.push({ time: "14:18", event: next.outcome === "stabilized" ? "Three monitoring reports confirm the response is stable before the impact window." : "Three monitoring reports confirm a degraded response; follow-up intervention is required.", kind: "system" });
  } else {
    next.timeline.push({ time: "14:10", event: "Monitoring report " + next.monitoringIntervals + " of 3 received. Impact window now estimated in " + next.minutesToImpact + " minutes.", kind: "system" });
  }
  return next;
}
