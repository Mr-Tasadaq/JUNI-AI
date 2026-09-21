import test from "node:test";
import assert from "node:assert/strict";
import { ToolRegistry } from "../core/tools.js";

test("registers and executes provider-neutral tools", async () => {
  const registry = new ToolRegistry();
  registry.register({
    name: "math.add",
    description: "Add two numbers.",
    inputSchema: {
      type: "object",
      properties: {
        a: { type: "number" },
        b: { type: "number" },
      },
      required: ["a", "b"],
      additionalProperties: false,
    },
    execute: async ({ a, b }) => a + b,
  });

  assert.equal(registry.has("math.add"), true);
  assert.equal(registry.list()[0].name, "math.add");
  assert.equal(await registry.execute("math.add", { a: 2, b: 3 }), 5);
});

test("rejects unsafe or duplicate registrations", () => {
  const registry = new ToolRegistry();
  const definition = {
    name: "math.add",
    description: "Add two numbers.",
    inputSchema: { type: "object" },
    execute: () => 1,
  };

  registry.register(definition);
  assert.throws(() => registry.register(definition), /already registered/);
  assert.throws(() => registry.register({ ...definition, name: "bad tool!" }), /Invalid tool name/);
});

test("validates tool arguments before execution", async () => {
  const registry = new ToolRegistry();
  registry.register({
    name: "math.multiply",
    description: "Multiply two numbers.",
    inputSchema: {
      type: "object",
      properties: {
        a: { type: "number", minimum: 0 },
        b: { type: "number", maximum: 10 },
      },
      required: ["a", "b"],
      additionalProperties: false,
    },
    execute: async ({ a, b }) => a * b,
  });

  await assert.rejects(
    () => registry.execute("math.multiply", { a: -1, b: 2 }),
    (error) => error.code === "TOOL_ARGUMENTS_INVALID"
  );
  await assert.rejects(
    () => registry.execute("math.multiply", { a: 1, b: 2, extra: true }),
    (error) => error.code === "TOOL_ARGUMENTS_INVALID"
  );
});

test("mutating tools require explicit approval and execution is bounded", async () => {
  const registry = new ToolRegistry({ maxExecutionMs: 50 });
  registry.register({
    name: "data.write",
    description: "Write data.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    metadata: { mutating: true },
    execute: async () => "ok",
  });

  await assert.rejects(
    () => registry.execute("data.write", {}),
    (error) => error.code === "TOOL_APPROVAL_REQUIRED"
  );

  assert.equal(await registry.execute("data.write", {}, { approved: true }), "ok");

  registry.register({
    name: "slow.read",
    description: "Slow read.",
    inputSchema: { type: "object", additionalProperties: false },
    execute: async () => new Promise((resolve) => setTimeout(() => resolve("late"), 100)),
  });

  await assert.rejects(
    () => registry.execute("slow.read", {}),
    (error) => error.code === "TOOL_TIMEOUT"
  );
});

test("tool results are size-limited", async () => {
  const registry = new ToolRegistry({ maxResultBytes: 1_024 });
  registry.register({
    name: "large.read",
    description: "Return large data.",
    inputSchema: { type: "object", additionalProperties: false },
    execute: async () => "x".repeat(2_000),
  });

  await assert.rejects(
    () => registry.execute("large.read", {}),
    (error) => error.code === "TOOL_RESULT_TOO_LARGE"
  );
});
