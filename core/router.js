import { normalizeRequest, capabilitySupports } from "./provider.js";
import { RouterError, normalizeProviderError } from "./errors.js";

function requirementsFor(request) {
  const required = ["text"];

  if (request.modality === "vision") required.push("vision");
  if (request.modality === "audio") required.push("audioInput");
  if (request.stream) required.push("streaming");
  if (request.tools.length) required.push("toolCalling");
  if (request.task === "voice") required.push("liveVoice");
  if (request.task === "research" && request.metadata?.requiresWebResearch) {
    required.push("webResearch");
  }

  return required;
}

function latencyScore(latency, provider) {
  const value = provider.latencyClass ?? "balanced";
  if (latency === "low") {
    return value === "low" ? 1 : value === "balanced" ? 0.5 : 0;
  }
  if (latency === "high-quality") {
    return value === "high-quality" ? 1 : value === "balanced" ? 0.75 : 0.25;
  }
  return value === "balanced" ? 1 : 0.75;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ModelRouter {
  #providers;
  #config;
  #events;

  constructor({ providers, config, events }) {
    this.#providers = new Map(
      Object.entries(providers).filter(([name]) => name !== "geminiLive")
    );
    this.#config = config;
    this.#events = events;
  }

  listProviders() {
    return [...this.#providers.values()];
  }

  getProvider(name) {
    return this.#providers.get(name);
  }

  async candidates(request) {
    if (request?.provider && !this.#providers.has(request.provider)) {
      throw new RouterError("Unknown provider requested: " + request.provider);
    }

    const normalized = normalizeRequest(request, {
      provider: this.#config.app.defaultProvider,
      model: this.#config.app.defaultModel,
    });

    const preferred = normalized.provider ? [normalized.provider] : [];
    const configured = [
      ...preferred,
      this.#config.app.defaultProvider,
      ...(this.#config.app.providerPriority ?? []),
      ...(this.#config.app.fallbackProviders ?? []),
    ];

    const unique = [...new Set(configured.filter(Boolean))];
    const requirements = requirementsFor(normalized);
    const scored = [];

    for (let index = 0; index < unique.length; index += 1) {
      const name = unique[index];
      const provider = this.#providers.get(name);
      if (!provider) continue;

      const health = await provider.health({
        model: normalized.model,
        signal: normalized.signal,
      });
      const model = normalized.model || provider.defaultModel;
      const capabilities = provider.capabilities(model);

      if (!capabilitySupports(capabilities, requirements)) continue;

      const score =
        (health.available ? this.#config.routing.availabilityWeight : 0) +
        capabilities.length * this.#config.routing.capabilityWeight +
        latencyScore(normalized.latency, provider) * this.#config.routing.latencyWeight +
        Math.max(0, 20 - index) * this.#config.routing.priorityWeight;

      scored.push({
        provider,
        model,
        health,
        capabilities,
        score,
        order: index,
      });
    }

    scored.sort((a, b) => b.score - a.score || a.order - b.order);
    return { request: normalized, candidates: scored };
  }

  async select(request) {
    const { request: normalized, candidates } = await this.candidates(request);
    const selected = candidates.find((candidate) => candidate.health.available);

    if (!selected) {
      throw new RouterError("No available provider satisfies the requested capabilities.");
    }

    this.#events?.emit("router.selected", {
      provider: selected.provider.name,
      model: selected.model,
      capabilities: selected.capabilities,
      task: normalized.task,
      modality: normalized.modality,
    }, {
      requestId: normalized.metadata?.requestId,
      provider: selected.provider.name,
      model: selected.model,
    });

    return selected;
  }

  async generate(request) {
    const { request: normalized, candidates } = await this.candidates(request);
    const attempts = [];
    const maxRetries = this.#config.app.maxProviderRetries ?? 1;

    if (!candidates.some((candidate) => candidate.health.available)) {
      throw new RouterError("No available provider satisfies the requested capabilities.");
    }
    const retryDelay = this.#config.app.retryBaseDelayMs ?? 250;

    for (const candidate of candidates) {
      if (!candidate.health.available) continue;

      for (let retry = 0; retry <= maxRetries; retry += 1) {
        const started = Date.now();

        this.#events?.emit("provider.started", {
          task: normalized.task,
          retry,
        }, {
          provider: candidate.provider.name,
          model: candidate.model,
          requestId: normalized.metadata?.requestId,
        });

        try {
          const response = await candidate.provider.generate(
            { ...normalized, model: candidate.model },
            { timeoutMs: candidate.health.timeoutMs }
          );

          this.#events?.emit("provider.completed", {
            latencyMs: Date.now() - started,
            usage: response.usage ?? null,
          }, {
            provider: candidate.provider.name,
            model: response.model ?? candidate.model,
            requestId: normalized.metadata?.requestId,
          });

          return {
            ...response,
            provider: response.provider ?? candidate.provider.name,
            model: response.model ?? candidate.model,
          };
        } catch (error) {
          const normalizedError = normalizeProviderError(candidate.provider.name, error);

          attempts.push({
            provider: candidate.provider.name,
            retry,
            code: normalizedError.code,
            status: normalizedError.status,
            retryable: normalizedError.retryable,
          });

          this.#events?.emit("provider.failed", {
            code: normalizedError.code,
            status: normalizedError.status,
            retryable: normalizedError.retryable,
            retry,
            latencyMs: Date.now() - started,
          }, {
            provider: candidate.provider.name,
            model: candidate.model,
            requestId: normalized.metadata?.requestId,
          });

          if (!normalizedError.retryable || retry >= maxRetries) {
            break;
          }

          const delayMs = retryDelay * (2 ** retry);
          this.#events?.emit("provider.retry", {
            delayMs,
            nextRetry: retry + 1,
            reason: normalizedError.code,
          }, {
            provider: candidate.provider.name,
            model: candidate.model,
            requestId: normalized.metadata?.requestId,
          });

          await sleep(delayMs);
        }
      }
    }

    throw new RouterError("All provider candidates failed.", { attempts });
  }

  async stream(request) {
    const { request: normalized, candidates } = await this.candidates(request);
    const attempts = [];

    for (const candidate of candidates) {
      if (!candidate.health.available) continue;

      try {
        return candidate.provider.stream(
          { ...normalized, model: candidate.model },
          { timeoutMs: candidate.health.timeoutMs }
        );
      } catch (error) {
        const normalizedError = normalizeProviderError(candidate.provider.name, error);
        attempts.push({
          provider: candidate.provider.name,
          code: normalizedError.code,
          retryable: normalizedError.retryable,
        });
        if (!normalizedError.retryable) throw normalizedError;
      }
    }

    throw new RouterError("No provider could create a stream.", { attempts });
  }
}

export function createRouter(options) {
  return new ModelRouter(options);
}
