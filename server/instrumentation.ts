import dotenv from "dotenv";
import { OpenAIAgentsInstrumentation } from "@arizeai/openinference-instrumentation-openai-agents";
import { register } from "@arizeai/phoenix-otel";
import * as agents from "@openai/agents";

// Load tracing configuration before any module creates an OpenAI Agents SDK run.
dotenv.config({ path: ".env.local" });

const enabled = process.env.PHOENIX_ENABLED === "true" || Boolean(process.env.PHOENIX_COLLECTOR_ENDPOINT || process.env.PHOENIX_API_KEY);
export const phoenixTracingEnabled = enabled;

if (enabled) {
  const provider = register({
    projectName: process.env.PHOENIX_PROJECT_NAME ?? "mars-mission-control",
    url: process.env.PHOENIX_COLLECTOR_ENDPOINT,
    apiKey: process.env.PHOENIX_API_KEY,
    batch: true
  });

  const instrumentation = new OpenAIAgentsInstrumentation({ tracerProvider: provider });
  // Keep the SDK's native OpenAI trace exporter while also sending OpenInference spans to Phoenix.
  instrumentation.manuallyInstrument(agents, { exclusiveProcessor: false });
  console.info("Phoenix tracing enabled for project " + (process.env.PHOENIX_PROJECT_NAME ?? "mars-mission-control") + ".");
}
