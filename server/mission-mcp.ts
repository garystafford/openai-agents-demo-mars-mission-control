import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

type MissionMcpContext = {
  scenario: {
    title: string;
    availableActions: string[];
    verification: Record<string, string>;
  };
  telemetry: { label: string; value: string; status: string; detail: string }[];
};

function missionContext(): MissionMcpContext {
  const source = process.env.MISSION_MCP_CONTEXT;
  if (!source) throw new Error("MISSION_MCP_CONTEXT is required.");
  return JSON.parse(source) as MissionMcpContext;
}

const context = missionContext();
const server = new McpServer({ name: "ares-7-mission-control", version: "1.0.0" });

server.registerTool(
  "mcp_read_mission_telemetry",
  {
    description: "Read current Ares-7 telemetry. Use this before making a recommendation.",
    inputSchema: { system: z.string().describe("A named system, or 'all' for all readings.") },
  },
  async ({ system }) => {
    const readings =
      system.toLowerCase() === "all"
        ? context.telemetry
        : context.telemetry.filter((item) =>
            item.label.toLowerCase().includes(system.toLowerCase())
          );
    return {
      content: [
        { type: "text", text: JSON.stringify(readings.length ? readings : context.telemetry) },
      ],
    };
  }
);

server.registerTool(
  "mcp_query_mission_protocol",
  {
    description: "Look up a mission safety protocol by topic.",
    inputSchema: { topic: z.string() },
  },
  async ({ topic }) => ({
    content: [
      {
        type: "text",
        text: [
          "Scenario: " + context.scenario.title + ".",
          "Protocol principle: protect crew and life-critical capability before research or convenience loads.",
          "Available actions: " + context.scenario.availableActions.join(", ") + ".",
          "Requested topic: " + topic + ".",
        ].join(" "),
      },
    ],
  })
);

server.registerTool(
  "mcp_request_independent_verification",
  {
    description:
      "Obtain an independent observation from orbital, maintenance, or crew sources when evidence is incomplete or conflicting.",
    inputSchema: { source: z.enum(["orbital", "maintenance", "crew"]) },
  },
  async ({ source }) => ({
    content: [{ type: "text", text: context.scenario.verification[source] }],
  })
);

await server.connect(new StdioServerTransport());
