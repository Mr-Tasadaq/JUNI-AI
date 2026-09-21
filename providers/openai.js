async function asyncLoadOpenAI() {
  const module = await import("openai");
  return module.default;
}
import { ProviderError } from "../core/errors.js";
import { CAPABILITIES } from "../core/provider.js";
import { requireApiKey, withAbortTimeout, providerUsage } from "./base.js";

function toOpenAIContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content.map((part) => {
    if (part.type === "text") return { type: "input_text", text: part.text };
    if (part.type === "image") {
      return {
        type: "input_image",
        image_url: "data:" + part.mimeType + ";base64," + part.data,
      };
    }
    if (part.type === "image_url") return { type: "input_image", image_url: part.url };
    if (part.type === "file") return { type: "input_file", file_id: part.fileId };
    if (part.type === "input_audio") return {
      type: "input_audio",
      audio: part.data,
      format: part.format ?? "wav",
    };
    return part;
  });
}

function toOpenAIInput(messages = []) {
  return messages.flatMap((message) => {
    if (message.role === "tool") {
      return [{
        type: "function_call_output",
        call_id: message.toolCallId,
        output: typeof message.content === "string"
          ? message.content
          : JSON.stringify(message.content),
      }];
    }

    if (message.role === "assistant" && message.toolCalls?.length) {
      return [
        ...(message.content ? [{
          role: "assistant",
          content: [{ type: "input_text", text: message.content }],
        }] : []),
        ...message.toolCalls.map((call) => ({
          type: "function_call",
          call_id: call.id,
          name: call.name,
          arguments: JSON.stringify(call.arguments ?? {}),
        })),
      ];
    }

    return [{
      role: message.role === "assistant" ? "assistant" : "user",
      content: toOpenAIContent(message.content),
    }];
  });
}

function toOpenAITools(tools = []) {
  return tools.map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
  }));
}

function extractToolCalls(response) {
  return (response.output ?? [])
    .filter((item) => item?.type === "function_call")
    .map((item) => {
      let argumentsObject = {};
      try { argumentsObject = JSON.parse(item.arguments || "{}"); } catch { /* normalized below */ }
      return {
        id: item.call_id || item.id,
        name: item.name,
        arguments: argumentsObject,
      };
    })
    .filter((item) => item.id && item.name);
}

export function createOpenAIProvider(config, { identity } = {}) {
  const providerConfig = config.providers.openai;
  let client;

  return {
    name: "openai",
    defaultModel: providerConfig.defaultModel,
    latencyClass: "balanced",

    capabilities(model = providerConfig.defaultModel) {
      const overrides = config.app.modelOverrides?.openai?.[model];
      return Object.freeze(overrides?.capabilities ?? [
        "text",
        "vision",
        "streaming",
        "toolCalling",
        "webResearch",
      ]);
    },

    researchCapabilities(model = providerConfig.defaultModel) {
      const override = config.app.modelOverrides?.openai?.[model]?.researchCapabilities;
      return Object.freeze(override ?? ["webSearch", "nativeCitations"]);
    },

    async research(request) {
      requireApiKey("openai", providerConfig.apiKey);
      const OpenAI = await asyncLoadOpenAI();
      client ??= new OpenAI({ apiKey: providerConfig.apiKey, timeout: providerConfig.timeoutMs });
      const filters = {};
      if (request.allowedDomains?.length) filters.allowed_domains = request.allowedDomains;
      if (request.blockedDomains?.length) filters.blocked_domains = request.blockedDomains;
      const timed = withAbortTimeout(request.signal, request.timeoutMs ?? config.research.providerTimeoutMs);
      try {
        const response = await client.responses.create({
          model: request.model || providerConfig.defaultModel,
          input: String(request.query ?? ""),
          tools: [{ type: config.research.openaiSearchToolType, ...(Object.keys(filters).length ? { filters } : {}) }],
          include: ["web_search_call.action.sources"],
          max_output_tokens: request.maxOutputTokens ?? 1200,
        }, { signal: timed.signal });
        return extractOpenAIResearch(response);
      } catch (error) {
        throw new ProviderError("OpenAI web research failed.", {
          provider: "openai", status: error?.status, code: error?.code || error?.name || "OPENAI_RESEARCH_ERROR",
          retryable: error?.retryable || error?.status === 408 || error?.status === 409 || error?.status === 429 || (error?.status >= 500),
          cause: error,
        });
      } finally { timed.cleanup(); }
    },

    async health() {
      return {
        available: Boolean(providerConfig.enabled && providerConfig.apiKey),
        configured: Boolean(providerConfig.apiKey),
        timeoutMs: providerConfig.timeoutMs,
        provider: "openai",
      };
    },

    async generate(request) {
      requireApiKey("openai", providerConfig.apiKey);
      const OpenAI = await asyncLoadOpenAI();
      client ??= new OpenAI({ apiKey: providerConfig.apiKey, timeout: providerConfig.timeoutMs });

      const timed = withAbortTimeout(request.signal, request.timeoutMs ?? providerConfig.timeoutMs);
      try {
        const response = await client.responses.create({
          model: request.model || providerConfig.defaultModel,
          instructions: identity,
          input: toOpenAIInput(request.messages),
          tools: toOpenAITools(request.tools),
          max_output_tokens: request.maxOutputTokens ?? 1200,
        }, { signal: timed.signal });

        return {
          provider: "openai",
          model: response.model ?? request.model ?? providerConfig.defaultModel,
          text: response.output_text ?? "",
          toolCalls: extractToolCalls(response),
          usage: providerUsage(response.usage),
          raw: response,
        };
      } catch (error) {
        throw new ProviderError("OpenAI generation failed.", {
          provider: "openai",
          status: error?.status,
          code: error?.code || error?.name || "OPENAI_ERROR",
          retryable: error?.retryable || error?.status === 408 || error?.status === 409 || error?.status === 429 || (error?.status >= 500) || /TIMEOUT|ABORT/i.test(String(error?.code || error?.name)),
          cause: error,
        });
      } finally {
        timed.cleanup();
      }
    },

    async *stream(request) {
      requireApiKey("openai", providerConfig.apiKey);
      client ??= new OpenAI({ apiKey: providerConfig.apiKey, timeout: providerConfig.timeoutMs });

      const timed = withAbortTimeout(request.signal, request.timeoutMs ?? providerConfig.timeoutMs);
      try {
        const stream = await client.responses.create({
          model: request.model || providerConfig.defaultModel,
          instructions: identity,
          input: toOpenAIInput(request.messages),
          tools: toOpenAITools(request.tools),
          stream: true,
          max_output_tokens: request.maxOutputTokens ?? 1200,
        }, { signal: timed.signal });

        for await (const event of stream) {
          if (event?.type === "response.output_text.delta" && event.delta) {
            yield { type: "text_delta", provider: "openai", model: request.model, text: event.delta };
          }

          if (event?.type === "response.function_call_arguments.done") {
            let args = {};
            try { args = JSON.parse(event.arguments || "{}"); } catch { /* leave empty */ }
            yield {
              type: "tool_call",
              provider: "openai",
              model: request.model,
              toolCall: {
                id: event.call_id || event.item_id,
                name: event.name,
                arguments: args,
              },
            };
          }

          if (event?.type === "response.completed") {
            yield {
              type: "completed",
              provider: "openai",
              model: event.response?.model ?? request.model,
              usage: providerUsage(event.response?.usage),
            };
          }
        }
      } catch (error) {
        throw new ProviderError("OpenAI streaming failed.", {
          provider: "openai",
          status: error?.status,
          code: error?.code || error?.name || "OPENAI_STREAM_ERROR",
          retryable: error?.status === 408 || error?.status === 429 || (error?.status >= 500),
          cause: error,
        });
      } finally {
        timed.cleanup();
      }
    },
  };
}

export { CAPABILITIES };


function extractOpenAIResearch(response) {
  const sources = [];
  const nativeCitations = [];
  const searchQueries = [];
  for (const item of response?.output ?? []) {
    if (item?.type === "web_search_call") {
      const action = item.action ?? {};
      if (action.query) searchQueries.push(action.query);
      if (Array.isArray(action.queries)) searchQueries.push(...action.queries);
      for (const source of action.sources ?? []) sources.push({
        url: source.url, title: source.title ?? null,
        publisher: source.publisher ?? null, publishedAt: source.published_at ?? null,
      });
    }
    for (const block of item?.content ?? []) {
      for (const annotation of block?.annotations ?? []) {
        if (annotation?.type === "url_citation") {
          nativeCitations.push({
            url: annotation.url, title: annotation.title ?? null,
            startIndex: annotation.start_index ?? annotation.startIndex ?? null,
            endIndex: annotation.end_index ?? annotation.endIndex ?? null,
            native: annotation,
          });
          if (annotation.url) sources.push({ url: annotation.url, title: annotation.title ?? null });
        }
      }
    }
  }
  return {
    text: response?.output_text ?? "",
    sources: dedupeByUrl(sources),
    nativeCitations,
    searchQueries: [...new Set(searchQueries.filter(Boolean))],
    usage: response?.usage ?? null,
    model: response?.model ?? null,
  };
}
function dedupeByUrl(items) {
  const seen = new Set();
  return items.filter((item) => item?.url && !seen.has(item.url) && seen.add(item.url));
}
