import { JuniError } from "./errors.js";

function assertToolDefinition(tool) {
  if (!tool || typeof tool !== "object") throw new JuniError("Tool definition must be an object.", { code: "INVALID_TOOL" });
  if (!/^[a-zA-Z0-9_.-]{1,64}$/.test(tool.name || "")) throw new JuniError("Invalid tool name.", { code: "INVALID_TOOL_NAME" });
  if (!tool.description || typeof tool.description !== "string") throw new JuniError("Tool description is required.", { code: "INVALID_TOOL_DESCRIPTION" });
  if (typeof tool.execute !== "function") throw new JuniError("Tool execute function is required.", { code: "INVALID_TOOL_EXECUTOR" });
  if (!tool.inputSchema || typeof tool.inputSchema !== "object") throw new JuniError("Tool inputSchema is required.", { code: "INVALID_TOOL_SCHEMA" });
}

export class ToolRegistry {
  #tools = new Map();

  register(tool) {
    assertToolDefinition(tool);
    if (this.#tools.has(tool.name)) throw new JuniError("Tool already registered: " + tool.name, { code: "DUPLICATE_TOOL" });

    const safeTool = Object.freeze({
      name: tool.name,
      description: tool.description,
      inputSchema: structuredClone(tool.inputSchema),
      execute: tool.execute,
      metadata: structuredClone(tool.metadata ?? {}),
    });

    this.#tools.set(tool.name, safeTool);
    return this;
  }

  has(name) { return this.#tools.has(name); }
  get(name) { return this.#tools.get(name); }

  list() {
    return [...this.#tools.values()].map(({ execute: _execute, ...definition }) => definition);
  }

  getProviderDefinitions() {
    return this.list();
  }

  async execute(name, args, context = {}) {
    const tool = this.#tools.get(name);
    if (!tool) throw new JuniError("Unknown tool: " + name, { code: "TOOL_NOT_FOUND" });
    return tool.execute(args, context);
  }
}

export function createToolRegistry() {
  return new ToolRegistry();
}
