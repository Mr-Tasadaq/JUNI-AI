import { z } from "zod";
import type { User } from "../drizzle/schema";

export const TOOL_RISK_LEVELS = [
  "read_only",
  "external_side_effect",
  "sensitive_action",
] as const;

export type ToolRiskLevel = (typeof TOOL_RISK_LEVELS)[number];

export function requiresConfirmationForRisk(riskLevel: ToolRiskLevel): boolean {
  return riskLevel !== "read_only";
}

export type ToolExecutionContext = {
  readonly user: Pick<User, "id" | "role">;
};

export type ToolResult = {
  readonly toolName: string;
  readonly status: "ok";
  readonly trustBoundary: "untrusted_external_data";
  readonly data: Readonly<Record<string, unknown>>;
};

export type ToolMetadata = {
  readonly name: string;
  readonly description: string;
  readonly riskLevel: ToolRiskLevel;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly requiresAuthentication: true;
  readonly requiresConfirmation: boolean;
  readonly serverOnly: true;
};

type ToolDefinition<Input> = ToolMetadata & {
  readonly parseInput: (input: unknown) => Input;
  readonly execute: (
    context: ToolExecutionContext,
    input: Input
  ) => Promise<Readonly<Record<string, unknown>>>;
};

export class ToolRegistryError extends Error {
  readonly code:
    | "unknown_tool"
    | "invalid_input"
    | "unauthenticated"
    | "execution_failed";

  constructor(
    code: ToolRegistryError["code"],
    message: string,
    options: { cause?: unknown } = {}
  ) {
    super(message, { cause: options.cause });
    this.name = "ToolRegistryError";
    this.code = code;
  }
}

const weatherInputSchema = z
  .object({
    location: z.string().trim().min(1).max(120),
  })
  .strict();

type WeatherInput = z.infer<typeof weatherInputSchema>;

const emptyInputSchema = z.object({}).strict();
type EmptyInput = z.infer<typeof emptyInputSchema>;

const weatherLookup: ToolDefinition<WeatherInput> = {
  name: "weather.lookup",
  description:
    "Return a deterministic placeholder weather result without making a network request.",
  riskLevel: "read_only",
  inputSchema: {
    type: "object",
    properties: {
      location: { type: "string", minLength: 1, maxLength: 120 },
    },
    required: ["location"],
    additionalProperties: false,
  },
  requiresAuthentication: true,
  requiresConfirmation: false,
  serverOnly: true,
  parseInput(input) {
    const result = weatherInputSchema.safeParse(input);
    if (!result.success) {
      throw new ToolRegistryError(
        "invalid_input",
        "Tool input does not match the registered schema."
      );
    }
    return result.data;
  },
  async execute(_context, input) {
    return {
      location: input.location,
      status: "placeholder",
      temperature: null,
      source: "deterministic_tool_fixture",
    };
  },
};

const deviceStatus: ToolDefinition<EmptyInput> = {
  name: "device.status",
  description:
    "Return a deterministic placeholder JUNI device status without contacting a device.",
  riskLevel: "read_only",
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  requiresAuthentication: true,
  requiresConfirmation: false,
  serverOnly: true,
  parseInput(input) {
    const result = emptyInputSchema.safeParse(input);
    if (!result.success) {
      throw new ToolRegistryError(
        "invalid_input",
        "Tool input does not match the registered schema."
      );
    }
    return result.data;
  },
  async execute() {
    return {
      device: "juni-server",
      status: "placeholder_ok",
      source: "deterministic_tool_fixture",
    };
  },
};

const TOOL_REGISTRY = {
  "weather.lookup": weatherLookup,
  "device.status": deviceStatus,
} as const;

type RegisteredToolName = keyof typeof TOOL_REGISTRY;

const TOOL_METADATA: readonly ToolMetadata[] = Object.freeze(
  Object.values(TOOL_REGISTRY).map(tool => ({
    name: tool.name,
    description: tool.description,
    riskLevel: tool.riskLevel,
    inputSchema: tool.inputSchema,
    requiresAuthentication: tool.requiresAuthentication,
    requiresConfirmation: tool.requiresConfirmation,
    serverOnly: tool.serverOnly,
  }))
);

function resolveRegisteredTool(name: string): ToolDefinition<unknown> {
  if (!(name in TOOL_REGISTRY)) {
    throw new ToolRegistryError("unknown_tool", "Tool is not registered.");
  }
  return TOOL_REGISTRY[name as RegisteredToolName] as ToolDefinition<unknown>;
}

export function listToolMetadata(): readonly ToolMetadata[] {
  return TOOL_METADATA;
}

export function getToolMetadata(name: string): ToolMetadata {
  return (
    listToolMetadata().find(tool => tool.name === name) ??
    (() => {
      throw new ToolRegistryError("unknown_tool", "Tool is not registered.");
    })()
  );
}

export async function executeTool(
  name: string,
  input: unknown,
  context: ToolExecutionContext | null | undefined
): Promise<ToolResult> {
  if (!context?.user || !Number.isSafeInteger(context.user.id)) {
    throw new ToolRegistryError(
      "unauthenticated",
      "Authenticated server identity is required to execute a tool."
    );
  }

  const tool = resolveRegisteredTool(name);
  const parsedInput = tool.parseInput(input);

  try {
    const data = await tool.execute(context, parsedInput);
    return {
      toolName: tool.name,
      status: "ok",
      trustBoundary: "untrusted_external_data",
      data,
    };
  } catch (error) {
    if (error instanceof ToolRegistryError) throw error;
    throw new ToolRegistryError(
      "execution_failed",
      "The registered tool could not complete safely.",
      { cause: error }
    );
  }
}
