import type { ModelResponse } from "@openai/agents";
import type { MissionUsage, ModelUsage } from "./mission.js";

type TokenPricing = {
  input: number;
  cachedInput: number;
  output: number;
};

const standardPricingPerMillion: Record<string, TokenPricing> = {
  "gpt-5.6-sol": { input: 5, cachedInput: 0.5, output: 30 },
  "gpt-5.6-terra": { input: 2, cachedInput: 0.2, output: 12 },
  "gpt-5.6-luna": { input: 0.2, cachedInput: 0.02, output: 1.2 },
};

function configuredPricing() {
  const value = process.env.MISSION_COST_PRICING_OVERRIDES?.trim();
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as Record<string, Partial<TokenPricing>>;
    return Object.fromEntries(
      Object.entries(parsed).flatMap(([model, rate]) => {
        if (
          !Number.isFinite(rate.input) ||
          !Number.isFinite(rate.cachedInput) ||
          !Number.isFinite(rate.output)
        )
          return [];
        return [[model, rate as TokenPricing]];
      })
    ) as Record<string, TokenPricing>;
  } catch {
    return {};
  }
}

const pricingPerMillion = { ...standardPricingPerMillion, ...configuredPricing() };

type UsageSample = {
  model: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
};

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function recordValue(record: Record<string, unknown> | undefined, key: string) {
  return numberValue(record?.[key]);
}

function usageSample(response: ModelResponse, fallbackModel: string): UsageSample {
  const provider = response.providerData;
  const rawUsage = response.rawUsage;
  const rawInputDetails = rawUsage?.input_tokens_details as Record<string, unknown> | undefined;
  const rawOutputDetails = rawUsage?.output_tokens_details as Record<string, unknown> | undefined;
  const normalizedInputDetails = response.usage.inputTokensDetails[0];
  const normalizedOutputDetails = response.usage.outputTokensDetails[0];
  const inputTokens = recordValue(rawUsage, "input_tokens") || response.usage.inputTokens;
  const outputTokens = recordValue(rawUsage, "output_tokens") || response.usage.outputTokens;
  return {
    model: typeof provider?.model === "string" ? provider.model : fallbackModel,
    inputTokens,
    cachedInputTokens:
      recordValue(rawInputDetails, "cached_tokens") ||
      recordValue(normalizedInputDetails, "cached_tokens"),
    outputTokens,
    reasoningTokens:
      recordValue(rawOutputDetails, "reasoning_tokens") ||
      recordValue(normalizedOutputDetails, "reasoning_tokens"),
    totalTokens: recordValue(rawUsage, "total_tokens") || response.usage.totalTokens,
  };
}

function estimateCost(
  usage: Pick<ModelUsage, "inputTokens" | "cachedInputTokens" | "outputTokens">,
  pricing: TokenPricing
) {
  const uncachedInput = Math.max(0, usage.inputTokens - usage.cachedInputTokens);
  return (
    (uncachedInput * pricing.input +
      usage.cachedInputTokens * pricing.cachedInput +
      usage.outputTokens * pricing.output) /
    1_000_000
  );
}

export class MissionUsageCollector {
  private readonly responseIds = new Set<string>();
  private readonly samples: UsageSample[] = [];

  record(responses: ModelResponse[], fallbackModel: string) {
    responses.forEach((response, index) => {
      const sample = usageSample(response, fallbackModel);
      const id =
        response.responseId ??
        [sample.model, sample.inputTokens, sample.outputTokens, sample.totalTokens, index].join(
          ":"
        );
      if (this.responseIds.has(id)) return;
      this.responseIds.add(id);
      this.samples.push(sample);
    });
  }

  summary(): MissionUsage {
    const byModel = new Map<string, ModelUsage>();
    for (const sample of this.samples) {
      const current = byModel.get(sample.model) ?? {
        model: sample.model,
        requests: 0,
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        visibleOutputTokens: 0,
        totalTokens: 0,
      };
      current.requests += 1;
      current.inputTokens += sample.inputTokens;
      current.cachedInputTokens += sample.cachedInputTokens;
      current.outputTokens += sample.outputTokens;
      current.reasoningTokens += sample.reasoningTokens;
      current.visibleOutputTokens += Math.max(0, sample.outputTokens - sample.reasoningTokens);
      current.totalTokens += sample.totalTokens;
      byModel.set(sample.model, current);
    }
    const models = [...byModel.values()].sort(
      (left, right) => right.totalTokens - left.totalTokens
    );
    const unpricedModels: string[] = [];
    for (const model of models) {
      const pricing = pricingPerMillion[model.model];
      if (pricing) model.estimatedCostUsd = estimateCost(model, pricing);
      else unpricedModels.push(model.model);
    }
    const sum = (selector: (model: ModelUsage) => number) =>
      models.reduce((total, model) => total + selector(model), 0);
    const estimatedCostUsd = unpricedModels.length
      ? undefined
      : sum((model) => model.estimatedCostUsd ?? 0);
    return {
      requests: sum((model) => model.requests),
      inputTokens: sum((model) => model.inputTokens),
      cachedInputTokens: sum((model) => model.cachedInputTokens),
      outputTokens: sum((model) => model.outputTokens),
      reasoningTokens: sum((model) => model.reasoningTokens),
      visibleOutputTokens: sum((model) => model.visibleOutputTokens),
      totalTokens: sum((model) => model.totalTokens),
      ...(estimatedCostUsd === undefined ? {} : { estimatedCostUsd }),
      unpricedModels,
      byModel: models,
    };
  }
}
