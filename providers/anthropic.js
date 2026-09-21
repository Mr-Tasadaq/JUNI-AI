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
    if (part.type === "image") {
      return {
        type: "image",
        source: {
          type: "base64",
          media_type: part.mimeType,
          data: part.data,
        },
      };
    }
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
        "webResearch",
      ]);
    },

    researchCapabilities(model = providerConfig.defaultModel) {
      const override = config.app.modelOverrides?.anthropic?.[model]?.researchCapabilities;
      return Object.freeze(override ?? ["webSearch", "nativeCitations"]);
    },

    async research(request) {
      requireApiKey("anthropic", providerConfig.apiKey);
      const Anthropic = await asyncLoadAnthropic();
      client ??= new Anthropic({ apiKey: providerConfig.apiKey, timeout: providerConfig.timeoutMs });
      const tool = {
        type: config.research.anthropicToolType,
        name: "web_search",
        max_uses: request.maxSearchUses ?? Math.max(1, request.maxSearchQueries ?? 2),
        allowed_callers: ["direct"],
      };
      if (request.allowedDomains?.length) tool.allowed_domains = request.allowedDomains;
      else if (request.blockedDomains?.length) tool.blocked_domains = request.blockedDomains;
      const timed = withAbortTimeout(request.signal, request.timeoutMs ?? config.research.providerTimeoutMs);
      try {
        const response = await client.messages.create({
          model: request.model || providerConfig.defaultModel,
          max_tokens: request.maxOutputTokens ?? 1600,
          messages: [{ role: "user", content: String(request.query ?? "") }],
          tools: [tool],
        }, { signal: timed.signal });
        return extractAnthropicResearch(response);
      } catch (error) {
        throw new ProviderError("Anthropic web research failed.", {
          provider: "anthropic", status: error?.status, code: error?.error?.type || error?.code || error?.name || "ANTHROPIC_RESEARCH_ERROR",
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


function extractAnthropicResearch(response) {
  let text = "";
  const sources = [];
  const nativeCitations = [];
  const searchQueries = [];
  for (const block of response?.content ?? []) {
    if (block?.type === "text") {
      text += block.text ?? "";
      for (const citation of block.citations ?? []) {
        if (citation?.type === "web_search_result_location" && citation.url) {
          sources.push({ url: citation.url, title: citation.title ?? null });
          nativeCitations.push({
            url: citation.url, title: citation.title ?? null,
            citedText: citation.cited_text ?? null, native: citation,
          });
        }
      }
    }
    if (block?.type === "server_tool_use" && block?.name === "web_search") {
      if (block.input?.query) searchQueries.push(block.input.query);
    }
    if (block?.type === "web_search_tool_result") {
      for (const result of block.content ?? []) {
        if (result?.url) sources.push({ url: result.url, title: result.title ?? null });
        if (result?.type === "web_search_result" && result?.url) sources.push({ url: result.url, title: result.title ?? null });
      }
    }
  }
  return { text:text.trim(), sources:dedupeAnthropicSources(sources), nativeCitations, searchQueries:[...new Set(searchQueries)], usage:response?.usage??null, model:response?.model??null, stopReason:response?.stop_reason??null };
}
function dedupeAnthropicSources(items){const seen=new Set();return items.filter(x=>x?.url&&!seen.has(x.url)&&seen.add(x.url));}
