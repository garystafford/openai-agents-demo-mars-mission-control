import dotenv from "dotenv";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { phoenixTracingEnabled } from "./instrumentation.js";
import { runMissionDirector } from "./agents.js";
import {
  advanceMission,
  approveCommand,
  createMission,
  requestCommand,
  specialistReports,
  type MissionState
} from "./mission.js";

dotenv.config({ path: ".env.local" });

const app = express();
app.use(express.json());

let mission: MissionState = createMission();

app.get("/health", (_req, res) => res.json({ ok: true, mission: mission.missionId, phoenixTracing: phoenixTracingEnabled }));
app.get("/api/mission", (_req, res) => res.json(mission));

app.post("/api/mission/reset", (_req, res) => {
  mission = createMission();
  res.json(mission);
});

app.post("/api/mission/assess", (_req, res) => {
  mission = { ...mission, phase: "assessment", reports: specialistReports(mission) };
  mission.timeline.push({ time: "14:04", event: "Mission Director dispatched NOVA, AURA, KEPLER, and MERCURY in parallel.", kind: "agent" });
  res.json(mission);
});

app.post("/api/mission/request-approval", (req, res) => {
  mission = requestCommand(mission, String(req.body?.plan ?? "combined survival plan"));
  res.json(mission);
});

app.post("/api/mission/approve", (req, res) => {
  mission = approveCommand(mission, Boolean(req.body?.approved));
  res.json(mission);
});

app.post("/api/mission/advance", (_req, res) => {
  mission = advanceMission(mission);
  res.json(mission);
});

app.post("/api/mission/director-brief", async (_req, res) => {
  try {
    const result = await runMissionDirector(mission);
    mission = { ...mission, councilLog: result.log };
    mission.timeline.push({ time: "14:05", event: "Mission Director completed the team decision brief.", kind: "agent" });
    res.json({ brief: result.brief, state: mission });
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : "Unable to reach the Mission Director." });
  }
});

app.post("/api/mission/convene", async (_req, res) => {
  mission = { ...mission, phase: "assessment", reports: specialistReports(mission), councilLog: [] };
  mission.timeline.push({ time: "14:04", event: "Mission Director asked NOVA, AURA, KEPLER, and MERCURY for an emergency assessment.", kind: "agent" });

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
    });
    mission = { ...mission, councilLog: result.log };
    mission.timeline.push({ time: "14:05", event: "Mission Director completed the team decision brief.", kind: "agent" });
    send({ type: "complete", brief: result.brief, state: mission });
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
