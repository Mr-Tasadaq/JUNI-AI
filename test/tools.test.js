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
