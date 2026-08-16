import { advanceMission, approveCommand, createMission, requestCommand, scenarioIds } from "../server/mission.js";

const cases = [
  {
    name: "new incidents rotate across distinct scenario types",
    run: () => new Set(scenarioIds.map((id) => createMission(id).scenario.title)).size === 3
  },
  {
    name: "approval gate appears before any command is applied",
    run: () => Boolean(requestCommand(createMission(), { actions: ["recall_eva"] }).pendingCommand)
  },
  {
    name: "complete dust-storm plan protects the returning EVA crew",
    run: () => {
      const pending = requestCommand(createMission(), { actions: ["recall_eva", "isolate_scrubber", "shed_nonessential_load"] });
      const approved = approveCommand(pending, true);
      const firstReport = advanceMission(approved);
      const secondReport = advanceMission(firstReport);
      const finalReport = advanceMission(secondReport);
      return approved.phase === "executing" && firstReport.telemetry.find((item) => item.label === "EVA crew")?.value === "Return route acquired" && secondReport.telemetry.find((item) => item.label === "EVA crew")?.value === "1.2 km from habitat" && finalReport.phase === "resolved" && finalReport.telemetry.find((item) => item.label === "EVA crew")?.status === "nominal";
    }
  },
  {
    name: "incomplete plan produces a degraded outcome rather than pretending success",
    run: () => approveCommand(requestCommand(createMission(), { actions: ["recall_eva"] }), true).outcome === "degraded"
  },
  {
    name: "declined command resumes assessment without changing mission configuration",
    run: () => {
      const pending = requestCommand(createMission(), { actions: ["recall_eva"] });
      const resumed = approveCommand(pending, false);
      return resumed.phase === "assessment" && !resumed.pendingCommand;
    }
  }
];

const results = cases.map((test) => ({ name: test.name, pass: test.run() }));
for (const result of results) console.log((result.pass ? "PASS " : "FAIL ") + result.name);
if (results.some((result) => !result.pass)) process.exit(1);
