import {
  advanceMission,
  approveCommand,
  createMission,
  randomScenarioId,
  requestCommand,
  scenarioIds,
} from "../server/mission.js";
import { MissionUsageCollector } from "../server/mission-usage.js";

const cases = [
  {
    name: "five distinct incident scenarios are available",
    run: () => new Set(scenarioIds.map((id) => createMission(id).scenario.title)).size === 5,
  },
  {
    name: "each incident presents a balanced six-reading telemetry set",
    run: () => scenarioIds.every((id) => createMission(id).telemetry.length === 6),
  },
  {
    name: "random incident selection does not immediately repeat the current scenario",
    run: () => scenarioIds.every((id) => randomScenarioId(id) !== id),
  },
  {
    name: "approval gate appears before any command is applied",
    run: () => Boolean(requestCommand(createMission(), { actions: ["recall_eva"] }).pendingCommand),
  },
  {
    name: "complete dust-storm plan protects the returning EVA crew",
    run: () => {
      const pending = requestCommand(createMission(), {
        actions: ["recall_eva", "isolate_scrubber", "shed_nonessential_load"],
      });
      const approved = approveCommand(pending, true);
      const firstReport = advanceMission(approved);
      const secondReport = advanceMission(firstReport);
      const finalReport = advanceMission(secondReport);
      return (
        approved.phase === "executing" &&
        firstReport.telemetry.find((item) => item.label === "EVA crew")?.value ===
          "Return route acquired" &&
        secondReport.telemetry.find((item) => item.label === "EVA crew")?.value ===
          "1.2 km from habitat" &&
        finalReport.phase === "resolved" &&
        finalReport.telemetry.find((item) => item.label === "EVA crew")?.status === "nominal"
      );
    },
  },
  {
    name: "incomplete plan produces a degraded outcome rather than pretending success",
    run: () =>
      approveCommand(requestCommand(createMission(), { actions: ["recall_eva"] }), true).outcome ===
      "degraded",
  },
  {
    name: "declined command resumes assessment without changing mission configuration",
    run: () => {
      const pending = requestCommand(createMission(), { actions: ["recall_eva"] });
      const resumed = approveCommand(pending, false);
      return resumed.phase === "assessment" && !resumed.pendingCommand;
    },
  },
  {
    name: "mission cost separates cached input and reasoning without double charging output",
    run: () => {
      const collector = new MissionUsageCollector();
      collector.record(
        [
          {
            responseId: "usage-eval-1",
            providerData: { model: "gpt-5.6-sol" },
            usage: {
              inputTokens: 1000,
              outputTokens: 500,
              totalTokens: 1500,
              inputTokensDetails: [{ cached_tokens: 100 }],
              outputTokensDetails: [{ reasoning_tokens: 300 }],
            },
            output: [],
          },
        ] as never,
        "gpt-5.6-sol"
      );
      const usage = collector.summary();
      return (
        usage.inputTokens === 1000 &&
        usage.cachedInputTokens === 100 &&
        usage.reasoningTokens === 300 &&
        usage.visibleOutputTokens === 200 &&
        usage.outputTokens === 500 &&
        usage.estimatedCostUsd === 0.01955
      );
    },
  },
];

const results = cases.map((test) => ({ name: test.name, pass: test.run() }));
for (const result of results) console.log((result.pass ? "PASS " : "FAIL ") + result.name);
if (results.some((result) => !result.pass)) process.exit(1);
