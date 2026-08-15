# Mission Control: Ares-7

An interactive multi-agent mission simulator built with the OpenAI Agents SDK.
You are the commander of a Mars habitat as a dust storm, a failing oxygen
recycler, reduced solar power, and an EVA crew create competing priorities.

## What it demonstrates

- A Mission Director calling four specialists through Agent.asTool()
- Typed function tools for telemetry and mission-protocol retrieval
- An SDK MemorySession to preserve multi-turn command context
- A streamed Team Record that exposes the Director's coordination, evidence retrieval, and specialist submissions as they happen
- A visible human approval gate before the simulated command is applied
- A deterministic mission simulator and trace ledger for repeatable demos
- Focused evaluation cases for assessment, approval, and safe resume behavior

## Run it

Run npm install, then npm run dev.

Open http://localhost:5173. The server reads OPENAI_API_KEY from .env.local;
it is only used when you select Get mission team assessment. The rest of the
simulator runs locally and deterministically.

## Phoenix tracing

Phoenix tracing is optional and does not affect the mission interface. Start a
Phoenix collector with Docker:

```bash
docker run -d --name phoenix -p 6006:6006 arizephoenix/phoenix:latest
```

Open Phoenix at http://localhost:6006, then add these values to `.env.local`:

```text
PHOENIX_ENABLED=true
PHOENIX_PROJECT_NAME=mars-mission-control
PHOENIX_COLLECTOR_ENDPOINT=http://localhost:6006
```

The app exports OpenInference spans for the Director, specialists, model calls,
and local tool calls. It keeps the OpenAI Agents SDK's native exporter enabled
as well. If Phoenix is not running, leave `PHOENIX_ENABLED` unset.

Useful local commands:

```bash
docker logs -f phoenix     # Follow collector logs
docker stop phoenix        # Stop the collector
docker start phoenix       # Start it again later
docker rm phoenix          # Remove the stopped container
```

## Demo sequence

1. Select **Get mission team assessment**.
2. Watch **Team activity** as the Director asks specialists for evidence and they submit assessments.
3. Read the Director’s recommendation, then select **Review proposed command**.
4. Authorize it, then advance the mission clock.
5. Review the team record and the resulting system state.

## Validate

Run npm run check, npm run eval, and npm run build.

## Next capabilities

The scaffolding deliberately keeps external systems simulated. The natural next
increment is a Mission Control MCP server for telemetry and inventory, followed
by a SandboxAgent counterfactual analyst that writes scenario artifacts in an
isolated workspace.
