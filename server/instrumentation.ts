import { OpenAIAgentsInstrumentation } from "@arizeai/openinference-instrumentation-openai-agents";
import { register } from "@arizeai/phoenix-otel";
import * as agents from "@openai/agents";
import "./env.js";

const enabled = process.env.PHOENIX_ENABLED === "true";
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
