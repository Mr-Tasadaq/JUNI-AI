async function asyncLoadGemini() {
  const module = await import("@google/genai");
  return module.GoogleGenAI;
}
import { ProviderError } from "../core/errors.js";
import { requireApiKey, withAbortTimeout, providerUsage } from "./base.js";

function toGeminiParts(content) {
  if (typeof content === "string") return [{ text: content }];
  if (!Array.isArray(content)) return [];

  return content.map((part) => {
    if (part.type === "text") return { text: part.text };
    if (part.type === "image") {
      return {
        inlineData: {
          data: part.data,
          mimeType: part.mimeType,
        },
      };
    }
    if (part.type === "image_url") return {
      fileData: { fileUri: part.url, mimeType: part.mimeType ?? "image/*" },
    };
    if (part.type === "file") {
      return {
        fileData: {
          fileUri: part.uri,
          mimeType: part.mimeType,
        },
      };
    }
    return part;
  });
}

function toGeminiContents(messages = []) {
  return messages.map((message) => {
    if (message.role === "tool") {
      return {
        role: "user",
        parts: [{
          functionResponse: {
            name: message.name,
            id: message.toolCallId,
            response: typeof message.content === "string" ? { result: message.content } : { result: message.content },
          },
        }],
      };
    }

    if (message.role === "assistant" && message.toolCalls?.length) {
      return {
        role: "model",
        parts: [
          ...(message.content ? [{ text: message.content }] : []),
          ...message.toolCalls.map((call) => ({
            functionCall: {
              id: call.id,
              name: call.name,
              args: call.arguments ?? {},
            },
          })),
        ],
      };
    }

    return {
      role: message.role === "assistant" ? "model" : "user",
      parts: toGeminiParts(message.content),
    };
  });
}

function toGeminiTools(tools = []) {
  if (!tools.length) return undefined;
  return [{
    functionDeclarations: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parametersJsonSchema: tool.inputSchema,
    })),
  }];
}

function extractFunctionCalls(response) {
  return (response.functionCalls ?? []).map((call) => ({
    id: call.id || call.name + "-" + Math.random().toString(36).slice(2),
    name: call.name,
    arguments: call.args ?? {},
  }));
}

export function createGeminiProvider(config, { identity } = {}) {
  const providerConfig = config.providers.gemini;
  let client;

  return {
    name: "gemini",
    defaultModel: providerConfig.defaultModel,
    latencyClass: "low",

    capabilities(model = providerConfig.defaultModel) {
      const overrides = config.app.modelOverrides?.gemini?.[model];
      return Object.freeze(overrides?.capabilities ?? [
        "text",
        "vision",
        "audioInput",
        "audioOutput",
        "streaming",
        "toolCalling",
        "webResearch",
        "liveVoice",
      ]);
    },

    async health() {
      return {
        available: Boolean(providerConfig.enabled && providerConfig.apiKey),
        configured: Boolean(providerConfig.apiKey),
        timeoutMs: providerConfig.timeoutMs,
        provider: "gemini",
      };
    },

    async generate(request) {
      requireApiKey("gemini", providerConfig.apiKey);
      const GoogleGenAI = await asyncLoadGemini();
      client ??= new GoogleGenAI({ apiKey: providerConfig.apiKey });

      const timed = withAbortTimeout(request.signal, request.timeoutMs ?? providerConfig.timeoutMs);
      try {
        const response = await client.models.generateContent({
          model: request.model || providerConfig.defaultModel,
          contents: toGeminiContents(request.messages),
          config: {
            systemInstruction: identity,
            tools: toGeminiTools(request.tools),
            maxOutputTokens: request.maxOutputTokens ?? 1200,
          },
        });

        return {
          provider: "gemini",
          model: request.model || providerConfig.defaultModel,
          text: response.text ?? "",
          toolCalls: extractFunctionCalls(response),
          usage: providerUsage(response.usageMetadata),
          raw: response,
        };
      } catch (error) {
        throw new ProviderError("Gemini generation failed.", {
          provider: "gemini",
          status: error?.status,
          code: error?.statusText || error?.code || error?.name || "GEMINI_ERROR",
          retryable: error?.status === 408 || error?.status === 429 || (error?.status >= 500),
          cause: error,
        });
      } finally {
        timed.cleanup();
      }
    },

    async *stream(request) {
      requireApiKey("gemini", providerConfig.apiKey);
      client ??= new GoogleGenAI({ apiKey: providerConfig.apiKey });

      const timed = withAbortTimeout(request.signal, request.timeoutMs ?? providerConfig.timeoutMs);
      try {
        const stream = await client.models.generateContentStream({
          model: request.model || providerConfig.defaultModel,
          contents: toGeminiContents(request.messages),
          config: {
            systemInstruction: identity,
            tools: toGeminiTools(request.tools),
            maxOutputTokens: request.maxOutputTokens ?? 1200,
          },
        });

        for await (const chunk of stream) {
          if (chunk.text) {
            yield { type: "text_delta", provider: "gemini", model: request.model, text: chunk.text };
          }

          for (const call of extractFunctionCalls(chunk)) {
            yield {
              type: "tool_call",
              provider: "gemini",
              model: request.model,
              toolCall: call,
            };
          }
        }

        yield { type: "completed", provider: "gemini", model: request.model };
      } catch (error) {
        throw new ProviderError("Gemini streaming failed.", {
          provider: "gemini",
          status: error?.status,
          code: error?.statusText || error?.code || error?.name || "GEMINI_STREAM_ERROR",
          retryable: error?.status === 408 || error?.status === 429 || (error?.status >= 500),
          cause: error,
        });
      } finally {
        timed.cleanup();
      }
    },
  };
}
