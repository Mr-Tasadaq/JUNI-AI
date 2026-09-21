import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../core/config.js";
import { EventBus, createMemoryEventSink } from "../core/events.js";
import { JuniCore } from "../core/juni.js";
import { createRouter } from "../core/router.js";
import { ToolRegistry } from "../core/tools.js";

function providerWithToolRound() {
  let calls = 0;
  return {
    name: "openai",
    defaultModel: "test-model",
    latencyClass: "balanced",
    capabilities: () => ["text", "toolCalling"],
    health: async () => ({ available: true, configured: true, timeoutMs: 1000 }),
    generate: async () => {
      calls += 1;
      if (calls === 1) {
        return {
          provider: "openai",
          model: "test-model",
          text: "",
          toolCalls: [{ id: "call-1", name: "math.add", arguments: { a: 2, b: 4 } }],
        };
      }
      return {
        provider: "openai",
        model: "test-model",
        text: "The answer is 6.",
        toolCalls: [],
      };
    },
    stream: async function* () {},
  };
}

function unavailableProvider(name) {
  return {
    name,
    defaultModel: "unused",
    capabilities: () => [],
    health: async () => ({ available: false }),
    generate: async () => ({ text: "" }),
    stream: async function* () {},
  };
}

test("Juni core orchestrates a tool call and records structured events", async () => {
  const config = loadConfig({
    JUNI_DEFAULT_PROVIDER: "openai",
    JUNI_FALLBACK_PROVIDERS: "",
    JUNI_MAX_TOOL_ROUNDS: "2",
  });

  const sink = createMemoryEventSink();
  const events = new EventBus();
  events.subscribe((event) => sink.push(event));

  const tools = new ToolRegistry();
  tools.register({
    name: "math.add",
    description: "Add two numbers.",
    inputSchema: { type: "object" },
    execute: ({ a, b }) => a + b,
  });

  const router = createRouter({
    providers: {
      openai: providerWithToolRound(),
      anthropic: unavailableProvider("anthropic"),
      gemini: unavailableProvider("gemini"),
    },
    config,
    events,
  });

  const juni = new JuniCore({ config, router, tools, events });
  const response = await juni.generate({
    messages: [{ role: "user", content: "Add 2 and 4." }],
  });

  assert.equal(response.text, "The answer is 6.");
  const types = sink.all().map((event) => event.type);
  assert.equal(types.includes("request.started"), true);
  assert.equal(types.includes("tool.started"), true);
  assert.equal(types.includes("tool.completed"), true);
  assert.equal(types.includes("request.completed"), true);
});

test("Juni sends the current message to generate and stream providers", async () => {
  const seen = [];
  const provider = {
    name: "openai",
    defaultModel: "test-model",
    capabilities: () => ["text", "streaming"],
    health: async () => ({ available: true, configured: true }),
    generate: async (request) => {
      seen.push(["generate", request.messages]);
      return { provider: "openai", model: "test-model", text: "ok", toolCalls: [] };
    },
    stream: async function* (request) {
      seen.push(["stream", request.messages]);
      yield { type: "text_delta", text: "ok" };
      yield { type: "completed", model: "test-model" };
    },
  };

  const config = loadConfig({
    JUNI_DEFAULT_PROVIDER: "openai",
    JUNI_FALLBACK_PROVIDERS: "",
  });
  const events = new EventBus();
  const tools = new ToolRegistry();
  const router = createRouter({
    providers: {
      openai: provider,
      anthropic: unavailableProvider("anthropic"),
      gemini: unavailableProvider("gemini"),
    },
    config,
    events,
  });
  const juni = new JuniCore({ config, router, tools, events });

  await juni.generate({ message: "current question", messages: [] });
  const streamed = [];
  for await (const event of juni.stream({ message: "stream question", messages: [] })) streamed.push(event);

  assert.equal(seen[0][1].at(-1).content, "current question");
  assert.equal(seen[1][1].at(-1).content, "stream question");
  assert.equal(streamed.at(-1).type, "completed");
});
