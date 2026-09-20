async function asyncLoadAnthropic() {
  const module = await import("@anthropic-ai/sdk");
  return module.default;
}
import { ProviderError } from "../core/errors.js";
import { requireApiKey, withAbortTimeout, providerUsage } from "./base.js";

function toAnthropicContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content.map((part) => {
    if (part.type === "text") return { type: "text", text: part.text };
    if (part.type === "image") return part;
    return part;
  });
}

function toAnthropicMessages(messages = []) {
  return messages.flatMap((message) => {
    if (message.role === "tool") {
      return [{
        role: "user",
        content: [{
          type: "tool_result",
          tool_use_id: message.toolCallId,
          content: typeof message.content === "string" ? message.content : JSON.stringify(message.content),
        }],
      }];
    }

    if (message.role === "assistant" && message.toolCalls?.length) {
      return [{
        role: "assistant",
        content: [
          ...(message.content ? [{ type: "text", text: message.content }] : []),
          ...message.toolCalls.map((call) => ({
            type: "tool_use",
            id: call.id,
            name: call.name,
            input: call.arguments ?? {},
          })),
        ],
      }];
    }

    return [{
      role: message.role === "assistant" ? "assistant" : "user",
      content: toAnthropicContent(message.content),
    }];
  });
}

function toAnthropicTools(tools = []) {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  }));
}

function extractResult(message) {
  const text = (message.content ?? [])
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");

  const toolCalls = (message.content ?? [])
    .filter((block) => block.type === "tool_use")
    .map((block) => ({
      id: block.id,
      name: block.name,
      arguments: block.input ?? {},
    }));

  return { text, toolCalls };
}

export function createAnthropicProvider(config, { identity } = {}) {
  const providerConfig = config.providers.anthropic;
  let client;

  return {
    name: "anthropic",
    defaultModel: providerConfig.defaultModel,
    latencyClass: "balanced",

    capabilities(model = providerConfig.defaultModel) {
      const overrides = config.app.modelOverrides?.anthropic?.[model];
      return Object.freeze(overrides?.capabilities ?? [
        "text",
        "vision",
        "streaming",
        "toolCalling",
      ]);
    },

    async health() {
      return {
        available: Boolean(providerConfig.enabled && providerConfig.apiKey),
        configured: Boolean(providerConfig.apiKey),
        timeoutMs: providerConfig.timeoutMs,
        provider: "anthropic",
      };
    },

    async generate(request) {
      requireApiKey("anthropic", providerConfig.apiKey);
      const Anthropic = await asyncLoadAnthropic();
      client ??= new Anthropic({ apiKey: providerConfig.apiKey, timeout: providerConfig.timeoutMs });

      const timed = withAbortTimeout(request.signal, request.timeoutMs ?? providerConfig.timeoutMs);
      try {
        const response = await client.messages.create({
          model: request.model || providerConfig.defaultModel,
          max_tokens: request.maxOutputTokens ?? 1200,
          system: identity,
          messages: toAnthropicMessages(request.messages),
          tools: toAnthropicTools(request.tools),
        }, { signal: timed.signal });

        const result = extractResult(response);

        return {
          provider: "anthropic",
          model: response.model ?? request.model ?? providerConfig.defaultModel,
          ...result,
          usage: providerUsage(response.usage),
          raw: response,
        };
      } catch (error) {
        throw new ProviderError("Anthropic generation failed.", {
          provider: "anthropic",
          status: error?.status,
          code: error?.error?.type || error?.code || error?.name || "ANTHROPIC_ERROR",
          retryable: error?.retryable || error?.status === 408 || error?.status === 409 || error?.status === 429 || (error?.status >= 500) || /TIMEOUT|ABORT/i.test(String(error?.code || error?.name)),
          cause: error,
        });
      } finally {
        timed.cleanup();
      }
    },

    async *stream(request) {
      requireApiKey("anthropic", providerConfig.apiKey);
      client ??= new Anthropic({ apiKey: providerConfig.apiKey });

      const timed = withAbortTimeout(request.signal, request.timeoutMs ?? providerConfig.timeoutMs);
      try {
        const stream = client.messages.stream({
          model: request.model || providerConfig.defaultModel,
          max_tokens: request.maxOutputTokens ?? 1200,
          system: identity,
          messages: toAnthropicMessages(request.messages),
          tools: toAnthropicTools(request.tools),
        }, { signal: timed.signal });

        for await (const event of stream) {
          if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
            yield { type: "text_delta", provider: "anthropic", model: request.model, text: event.delta.text };
          }
          if (event.type === "message_stop") {
            yield { type: "completed", provider: "anthropic", model: request.model };
          }
        }
      } catch (error) {
        throw new ProviderError("Anthropic streaming failed.", {
          provider: "anthropic",
          status: error?.status,
          code: error?.error?.type || error?.code || error?.name || "ANTHROPIC_STREAM_ERROR",
          retryable: error?.retryable || error?.status === 408 || error?.status === 429 || (error?.status >= 500) || /TIMEOUT|ABORT/i.test(String(error?.code || error?.name)),
          cause: error,
        });
      } finally {
        timed.cleanup();
      }
    },
  };
}
