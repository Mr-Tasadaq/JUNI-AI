const DEFAULT_MAX_SAMPLES = 500;

function numeric(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index];
}

export class MetricsCollector {
  #startedAt = Date.now();
  #maxSamples;
  #events = 0;
  #requests = 0;
  #completed = 0;
  #failed = 0;
  #active = 0;
  #tokens = 0;
  #cost = 0;
  #costEvents = 0;
  #counts = new Map();
  #providers = new Map();

  constructor({ maxSamples = DEFAULT_MAX_SAMPLES } = {}) {
    this.#maxSamples = Math.max(50, Math.min(5_000, Number(maxSamples) || DEFAULT_MAX_SAMPLES));
  }

  consume(event) {
    this.#events += 1;
    this.#counts.set(event.type, (this.#counts.get(event.type) ?? 0) + 1);

    if (event.type === "request.started") {
      this.#requests += 1;
      this.#active += 1;
    }

    if (event.type === "request.completed") {
      this.#completed += 1;
      this.#active = Math.max(0, this.#active - 1);
    }

    if (event.type === "request.failed") {
      this.#failed += 1;
      this.#active = Math.max(0, this.#active - 1);
    }

    const provider = event.provider;
    if (!provider) return;

    const model = event.model ?? "unknown";
    const key = provider + "/" + model;
    const current = this.#providers.get(key) ?? {
      provider,
      model,
      started: 0,
      completed: 0,
      failed: 0,
      retries: 0,
      latenciesMs: [],
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cost: 0,
      costEvents: 0,
    };

    if (event.type === "provider.started") current.started += 1;
    if (event.type === "provider.completed") {
      current.completed += 1;
      if (Number.isFinite(Number(event.data?.latencyMs))) {
        current.latenciesMs.push(Number(event.data.latencyMs));
        if (current.latenciesMs.length > this.#maxSamples) current.latenciesMs.shift();
      }
      const usage = event.data?.usage;
      if (usage) {
        current.inputTokens += numeric(usage.inputTokens);
        current.outputTokens += numeric(usage.outputTokens);
        current.totalTokens += numeric(usage.totalTokens);
        if (Number.isFinite(Number(usage.cost))) {
          current.cost += Number(usage.cost);
          current.costEvents += 1;
          this.#cost += Number(usage.cost);
          this.#costEvents += 1;
        }
      }
    }
    if (event.type === "provider.failed") current.failed += 1;
    if (event.type === "provider.retry") current.retries += 1;

    this.#providers.set(key, current);

    if (event.type === "request.completed") {
      const usage = event.data?.usage;
      if (usage) this.#tokens += numeric(usage.totalTokens);
    }
  }

  snapshot() {
    const providerStats = [...this.#providers.values()].map((item) => ({
      provider: item.provider,
      model: item.model,
      started: item.started,
      completed: item.completed,
      failed: item.failed,
      retries: item.retries,
      latencyMs: {
        p50: percentile(item.latenciesMs, 0.5),
        p95: percentile(item.latenciesMs, 0.95),
        sampleCount: item.latenciesMs.length,
      },
      tokens: {
        input: item.inputTokens,
        output: item.outputTokens,
        total: item.totalTokens,
      },
      cost: item.costEvents ? item.cost : null,
      costEvents: item.costEvents,
    }));

    return Object.freeze({
      startedAt: new Date(this.#startedAt).toISOString(),
      uptimeSeconds: Math.max(0, Math.floor((Date.now() - this.#startedAt) / 1000)),
      events: this.#events,
      requests: {
        total: this.#requests,
        completed: this.#completed,
        failed: this.#failed,
        active: this.#active,
        successRate: this.#requests ? this.#completed / this.#requests : null,
      },
      tokens: { total: this.#tokens },
      cost: this.#costEvents ? this.#cost : null,
      costEvents: this.#costEvents,
      eventCounts: Object.fromEntries(this.#counts),
      providers: providerStats,
    });
  }
}

export function createMetricsCollector(options = {}) {
  return new MetricsCollector(options);
}
