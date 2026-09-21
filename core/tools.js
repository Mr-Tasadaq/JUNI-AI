import { JuniError } from "./errors.js";

function validationError(message, details = {}) {
  return new JuniError(message, { code: "TOOL_ARGUMENTS_INVALID", details });
}

function validateSchema(value, schema, path = "$") {
  if (!schema || typeof schema !== "object") return;

  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw validationError("Tool arguments must be an object.", { path });
    }

    const required = Array.isArray(schema.required) ? schema.required : [];
    for (const key of required) {
      if (!Object.hasOwn(value, key)) {
        throw validationError("Missing required tool argument: " + key, { path: path + "." + key });
      }
    }

    const properties = schema.properties && typeof schema.properties === "object" ? schema.properties : {};
    for (const [key, propertySchema] of Object.entries(properties)) {
      if (Object.hasOwn(value, key)) validateSchema(value[key], propertySchema, path + "." + key);
    }

    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(properties, key)) {
          throw validationError("Unexpected tool argument: " + key, { path: path + "." + key });
        }
      }
    }
    return;
  }

  if (schema.type === "array") {
    if (!Array.isArray(value)) throw validationError("Tool argument must be an array.", { path });
    if (schema.maxItems != null && value.length > Number(schema.maxItems)) {
      throw validationError("Tool argument has too many items.", { path });
    }
    if (schema.items) value.forEach((item, index) => validateSchema(item, schema.items, path + "[" + index + "]"));
    return;
  }

  if (schema.type === "string") {
    if (typeof value !== "string") throw validationError("Tool argument must be a string.", { path });
    if (schema.maxLength != null && value.length > Number(schema.maxLength)) {
      throw validationError("Tool argument is too long.", { path });
    }
    if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
      throw validationError("Tool argument is not an allowed value.", { path });
    }
    return;
  }

  if (schema.type === "number" || schema.type === "integer") {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw validationError("Tool argument must be a finite number.", { path });
    }
    if (schema.type === "integer" && !Number.isInteger(value)) {
      throw validationError("Tool argument must be an integer.", { path });
    }
    if (schema.minimum != null && value < Number(schema.minimum)) {
      throw validationError("Tool argument is below the minimum.", { path });
    }
    if (schema.maximum != null && value > Number(schema.maximum)) {
      throw validationError("Tool argument is above the maximum.", { path });
    }
    return;
  }

  if (schema.type === "boolean" && typeof value !== "boolean") {
    throw validationError("Tool argument must be boolean.", { path });
  }
}

function assertToolDefinition(tool) {
  if (!tool || typeof tool !== "object") throw new JuniError("Tool definition must be an object.", { code: "INVALID_TOOL" });
  if (!/^[a-zA-Z0-9_.-]{1,64}$/.test(tool.name || "")) throw new JuniError("Invalid tool name.", { code: "INVALID_TOOL_NAME" });
  if (!tool.description || typeof tool.description !== "string") throw new JuniError("Tool description is required.", { code: "INVALID_TOOL_DESCRIPTION" });
  if (typeof tool.execute !== "function") throw new JuniError("Tool execute function is required.", { code: "INVALID_TOOL_EXECUTOR" });
  if (!tool.inputSchema || typeof tool.inputSchema !== "object") throw new JuniError("Tool inputSchema is required.", { code: "INVALID_TOOL_SCHEMA" });
}

function safeTimeout(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(120_000, parsed) : fallback;
}

function safeResult(value, maxBytes) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (text.length > maxBytes) {
    throw new JuniError("Tool result exceeded the configured size limit.", {
      code: "TOOL_RESULT_TOO_LARGE",
      details: { maxBytes },
    });
  }
  return value;
}

export class ToolRegistry {
  #tools = new Map();
  #defaults;

  constructor({ maxExecutionMs = 15_000, maxResultBytes = 64_000, requireApprovalForMutations = true } = {}) {
    this.#defaults = Object.freeze({
      maxExecutionMs: safeTimeout(maxExecutionMs, 15_000),
      maxResultBytes: Math.max(1_024, Math.min(1_000_000, Number(maxResultBytes) || 64_000)),
      requireApprovalForMutations: Boolean(requireApprovalForMutations),
    });
  }

  register(tool) {
    assertToolDefinition(tool);
    if (this.#tools.has(tool.name)) throw new JuniError("Tool already registered: " + tool.name, { code: "DUPLICATE_TOOL" });

    const metadata = structuredClone(tool.metadata ?? {});
    if (metadata.mutating && this.#defaults.requireApprovalForMutations) metadata.requiresApproval = true;

    const safeTool = Object.freeze({
      name: tool.name,
      description: tool.description,
      inputSchema: structuredClone(tool.inputSchema),
      execute: tool.execute,
      metadata,
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

  async execute(name, args = {}, context = {}) {
    const tool = this.#tools.get(name);
    if (!tool) throw new JuniError("Unknown tool: " + name, { code: "TOOL_NOT_FOUND" });

    validateSchema(args, tool.inputSchema);

    if (tool.metadata.requiresApproval && context.approved !== true) {
      throw new JuniError("Tool execution requires explicit approval.", {
        code: "TOOL_APPROVAL_REQUIRED",
        details: { tool: tool.name },
      });
    }

    const timeoutMs = safeTimeout(tool.metadata.timeoutMs, this.#defaults.maxExecutionMs);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    timeout.unref?.();

    const executionContext = Object.freeze({
      ...context,
      signal: context.signal ?? controller.signal,
      toolName: tool.name,
      toolMetadata: tool.metadata,
    });

    try {
      const result = await Promise.race([
        Promise.resolve(tool.execute(args, executionContext)),
        new Promise((_, reject) => {
          controller.signal.addEventListener("abort", () => {
            reject(new JuniError("Tool execution timed out.", {
              code: "TOOL_TIMEOUT",
              details: { timeoutMs },
            }));
          }, { once: true });
        }),
      ]);

      return safeResult(result, Number(tool.metadata.maxResultBytes) > 0
        ? Math.min(1_000_000, Number(tool.metadata.maxResultBytes))
        : this.#defaults.maxResultBytes);
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function createToolRegistry(options = {}) {
  return new ToolRegistry(options);
}

export { validateSchema };
