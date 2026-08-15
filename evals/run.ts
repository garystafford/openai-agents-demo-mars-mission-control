import { approveCommand, createMission, requestCommand, specialistReports } from "../server/mission.js";

const cases = [
  {
    name: "assessment returns the four required independent perspectives",
    run: () => specialistReports(createMission()).length === 4
  },
  {
    name: "approval gate appears before any command is applied",
    run: () => Boolean(requestCommand(createMission(), "combined survival plan").pendingCommand)
  },
  {
    name: "approved command protects the returning EVA crew",
    run: () => {
      const pending = requestCommand(createMission(), "combined survival plan");
      const resolved = approveCommand(pending, true);
      return resolved.phase === "executing" && resolved.telemetry.find((item) => item.label === "EVA crew")?.status === "nominal";
    }
  },
  {
    name: "declined command resumes assessment without changing mission configuration",
    run: () => {
      const pending = requestCommand(createMission(), "combined survival plan");
      const resumed = approveCommand(pending, false);
      return resumed.phase === "assessment" && !resumed.pendingCommand;
    }
  }
];

const results = cases.map((test) => ({ name: test.name, pass: test.run() }));
for (const result of results) console.log((result.pass ? "PASS " : "FAIL ") + result.name);
if (results.some((result) => !result.pass)) process.exit(1);
