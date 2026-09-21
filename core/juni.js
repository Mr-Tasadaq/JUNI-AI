import { randomUUID } from "node:crypto";
import { normalizeRequest } from "./provider.js";
import { RouterError } from "./errors.js";
import { buildSystemIdentity } from "./identity.js";

function toolDefinitions(registry, enabled = true) {
  return enabled && registry ? registry.getProviderDefinitions() : [];
}

function isToolCallResponse(response) {
  return Array.isArray(response?.toolCalls) && response.toolCalls.length > 0;
}

export class JuniCore {
  #config;
  #router;
  #tools;
  #events;

  constructor({ config, router, tools, events }) {
    this.#config = config;
    this.#router = router;
    this.#tools = tools;
    this.#events = events;
  }

  async generate(request = {}) {
    const requestId = request.metadata?.requestId ?? randomUUID();
    const normalized = normalizeRequest(request, {
      model: this.#config.app.defaultModel,
    });

    const started = Date.now();
    let providerOverride = normalized.provider;
    let messages = [...normalized.messages];

    const maxHistory = this.#config.security.maxHistory;
    if (messages.length > maxHistory) {
      messages = messages.slice(-maxHistory);
    }

    const lastMessage = messages.at(-1);
    const currentMessagePresent = normalized.message
      && lastMessage?.role === "user"
      && (lastMessage.content === normalized.message
        || (Array.isArray(lastMessage.content)
          && lastMessage.content.some((part) =>
            part?.type === "text" && part.text === normalized.message)));

    if (currentMessagePresent && lastMessage.content === normalized.message) {
      messages.pop();
    }

    if (normalized.message && !currentMessagePresent) {
      messages.push({ role: "user", content: normalized.message });
    }

    this.#events?.emit("request.started", {
      task: normalized.task,
      modality: normalized.modality,
      stream: normalized.stream,
      toolCount: normalized.tools.length,
    }, { requestId });

    try {
      for (let round = 0; round <= this.#config.app.maxToolRounds; round += 1) {
        const response = await this.#router.generate({
          ...normalized,
          provider: providerOverride,
          messages,
          tools: toolDefinitions(this.#tools, this.#config.tools?.enabled !== false && this.#config.app.featureFlags.tools),
          metadata: { ...normalized.metadata, requestId },
        });

        if (!isToolCallResponse(response) || !this.#config.app.featureFlags.tools) {
          this.#events?.emit("request.completed", {
            latencyMs: Date.now() - started,
            provider: response.provider,
            model: response.model,
            usage: response.usage ?? null,
          }, { requestId, provider: response.provider, model: response.model });

          return response;
        }

        if (round === this.#config.app.maxToolRounds) {
          throw new RouterError("Tool-calling loop exceeded the configured maximum.", {
            details: { maxToolRounds: this.#config.app.maxToolRounds },
          });
        }

        messages.push({
          role: "assistant",
          content: response.text ?? "",
          toolCalls: response.toolCalls,
          provider: response.provider,
        });

        for (const call of response.toolCalls) {
          const tool = this.#tools?.get(call.name);
          if (!tool) {
            throw new RouterError("Provider requested an unregistered tool: " + call.name);
          }

          const toolStarted = Date.now();
          this.#events?.emit("tool.started", {
            name: call.name,
            arguments: call.arguments ?? {},
          }, { requestId, provider: response.provider, model: response.model });

          try {
            const result = await this.#tools.execute(call.name, call.arguments ?? {}, {
              requestId,
              provider: response.provider,
              model: response.model,
              approved: request.metadata?.toolApproval === true,
            });

            messages.push({
              role: "tool",
              toolCallId: call.id,
              name: call.name,
              content: result,
            });

            this.#events?.emit("tool.completed", {
              name: call.name,
              latencyMs: Date.now() - toolStarted,
            }, { requestId, provider: response.provider, model: response.model });
          } catch (error) {
            this.#events?.emit("tool.failed", {
              name: call.name,
              latencyMs: Date.now() - toolStarted,
              code: error?.code ?? "TOOL_ERROR",
            }, { requestId, provider: response.provider, model: response.model });
            throw error;
          }
        }

        providerOverride = response.provider;
      }

      throw new RouterError("Juni request loop terminated unexpectedly.");
    } catch (error) {
      this.#events?.emit("request.failed", {
        latencyMs: Date.now() - started,
        code: error?.code ?? error?.name ?? "JUNI_ERROR",
        message: error?.message ?? "Request failed.",
      }, { requestId });
      throw error;
    }
  }

  async *stream(request = {}) {
    if (request.tools?.length || this.#tools?.list().length) {
      // Step 1 exposes the streaming contract; tool orchestration remains in the non-streaming core loop.
      // This avoids inventing a partial streamed tool protocol.
    }

    const requestId = request.metadata?.requestId ?? randomUUID();
    const normalized = normalizeRequest(request, {
      model: this.#config.app.defaultModel,
    });

    this.#events?.emit("request.started", {
      task: normalized.task,
      modality: normalized.modality,
      stream: true,
    }, { requestId });

    try {
      const stream = await this.#router.stream({
        ...normalized,
        tools: toolDefinitions(this.#tools, this.#config.tools?.enabled !== false && this.#config.app.featureFlags.tools),
        metadata: { ...normalized.metadata, requestId },
      });

      for await (const event of stream) {
        yield { ...event, requestId };
      }

      this.#events?.emit("request.completed", {
        streamed: true,
      }, { requestId });
    } catch (error) {
      this.#events?.emit("request.failed", {
        code: error?.code ?? error?.name ?? "JUNI_ERROR",
        message: error?.message ?? "Streaming failed.",
      }, { requestId });
      throw error;
    }
  }

  identity(extraInstructions = "") {
    return buildSystemIdentity(extraInstructions);
  }

  providerStatus() {
    return this.#router.listProviders().map((provider) => ({
      name: provider.name,
      model: provider.defaultModel,
      latencyClass: provider.latencyClass ?? "balanced",
    }));
  }

  async providerHealth() {
    const providers = await Promise.all(
      this.#router.listProviders().map(async (provider) => ({
        name: provider.name,
        model: provider.defaultModel,
        ...(await provider.health({ model: provider.defaultModel })),
      }))
    );

    return providers;
  }
}

export function createJuni(options) {
  return new JuniCore(options);
}
