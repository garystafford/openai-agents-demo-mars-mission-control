import dotenv from "dotenv";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { publicAgentProfiles } from "./agent-profiles.js";
import { phoenixTracingEnabled } from "./instrumentation.js";
import { clearMissionSession, runMissionDirector } from "./agents.js";
import {
  advanceMission,
  approveCommand,
  createMission,
  requestCommand,
  scenarioIds,
  type MissionState
} from "./mission.js";

dotenv.config({ path: ".env.local" });

const app = express();
app.use(express.json());

let scenarioIndex = 0;
let mission: MissionState = createMission(scenarioIds[scenarioIndex]);
const missionResponse = () => ({ ...mission, agentProfiles: publicAgentProfiles });

app.get("/health", (_req, res) => res.json({ ok: true, mission: mission.missionId, phoenixTracing: phoenixTracingEnabled }));
app.get("/api/mission", (_req, res) => res.json(missionResponse()));

app.post("/api/mission/reset", (_req, res) => {
  clearMissionSession(mission.missionId);
  scenarioIndex = (scenarioIndex + 1) % scenarioIds.length;
  mission = createMission(scenarioIds[scenarioIndex]);
  res.json(missionResponse());
});

app.post("/api/mission/assess", (_req, res) => {
  mission = { ...mission, phase: "assessment", reports: [], councilLog: [] };
  mission.timeline.push({ time: "14:04", event: "Mission Director began an adaptive investigation.", kind: "agent" });
  res.json(missionResponse());
});

app.post("/api/mission/request-approval", (req, res) => {
  mission = requestCommand(mission, req.body?.plan ?? {});
  res.json(missionResponse());
});

app.post("/api/mission/approve", (req, res) => {
  mission = approveCommand(mission, Boolean(req.body?.approved));
  res.json(missionResponse());
});

app.post("/api/mission/advance", (_req, res) => {
  mission = advanceMission(mission);
  res.json(missionResponse());
});

app.post("/api/mission/director-brief", async (_req, res) => {
  try {
    const result = await runMissionDirector(mission);
    mission = { ...mission, councilLog: result.log, reports: result.reports };
    mission.timeline.push({ time: "14:05", event: "Mission Director completed the team decision brief.", kind: "agent" });
    res.json({ plan: result.plan, state: missionResponse() });
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : "Unable to reach the Mission Director." });
  }
});

app.post("/api/mission/convene", async (req, res) => {
  const reviewRequest = typeof req.body?.reviewRequest === "string" ? req.body.reviewRequest.trim() : "";
  const previousPlan = req.body?.previousPlan;
  mission = { ...mission, phase: "assessment", reports: [], councilLog: [] };
  mission.timeline.push({ time: "14:04", event: reviewRequest ? "Commander requested a plan review: " + reviewRequest : "Mission Director began an adaptive investigation.", kind: "agent" });

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const send = (payload: unknown) => res.write("data: " + JSON.stringify(payload) + "\n\n");
  try {
    const result = await runMissionDirector(mission, (entry) => {
      mission.councilLog.push(entry);
      send({ type: "activity", entry });
    }, (report) => {
      mission.reports.push(report);
      send({ type: "report", report });
    }, reviewRequest || undefined, previousPlan);
    mission = { ...mission, councilLog: result.log, reports: result.reports };
    mission.timeline.push({ time: "14:05", event: reviewRequest ? "Mission Director completed the commander-requested plan review." : "Mission Director completed the team decision brief.", kind: "agent" });
    send({ type: "complete", plan: result.plan, state: missionResponse() });
  } catch (error) {
    send({ type: "error", message: error instanceof Error ? error.message : "The mission team could not complete its assessment." });
  } finally {
    res.end();
  }
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.resolve(__dirname, "../dist");
app.use(express.static(clientDir));
app.get("/{*splat}", (_req, res) => res.sendFile(path.join(clientDir, "index.html")));

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => console.log("Mission Control API listening on " + port));
