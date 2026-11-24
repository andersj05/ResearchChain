import type { components } from "@researchchain/contracts";

type Setup = components["schemas"]["ResearchSessionSetup"];
export type ModelProfile = Pick<Setup, "model" | "reasoning_effort" | "verbosity">;
export type ModelOverride = NonNullable<Setup["lead"]>;
export type ProviderModel = components["schemas"]["ProviderModel"];
type ResearchConfig = components["schemas"]["ResearchConfig"];
export type StepModelSettings = Pick<
  ResearchConfig,
  "model" | "reasoning_effort" | "verbosity" | "team"
>;
export type Effort = NonNullable<ModelProfile["reasoning_effort"]>;
export type Verbosity = NonNullable<ModelProfile["verbosity"]>;

export const researchRoles = [
  { key: "lead", label: "Research lead" },
  { key: "researcher", label: "Researchers" },
  { key: "editor", label: "Report editor" },
] as const;

export function resolveModelProfile(
  base: ModelProfile,
  override?: ModelOverride | null,
): ModelProfile {
  return {
    model: override?.model || base.model,
    reasoning_effort:
      override?.reasoning_effort === "model_default"
        ? null
        : (override?.reasoning_effort ?? base.reasoning_effort ?? null),
    verbosity:
      override?.verbosity === "model_default"
        ? null
        : (override?.verbosity ?? base.verbosity ?? null),
  };
}

export function modelSettingLabel(value?: string | null): string {
  if (!value || value === "model_default") return "Model default";
  if (value === "xhigh") return "Extra high";
  return value[0]!.toUpperCase() + value.slice(1);
}

export function hasModelOverride(override?: ModelOverride | null) {
  return !!(override?.model || override?.reasoning_effort || override?.verbosity);
}

export function modelProfileProblem(
  models: readonly ProviderModel[],
  profile: ModelProfile,
): string {
  const model = models.find((entry) => entry.slug === profile.model);
  if (!model)
    return `Choose an available model to replace ${profile.model || "the current selection"}.`;
  if (profile.reasoning_effort && !model.reasoning_efforts?.includes(profile.reasoning_effort))
    return `${model.slug} does not offer ${modelSettingLabel(profile.reasoning_effort)} thinking effort. Choose an available effort or the model default.`;
  if (profile.verbosity && !model.supports_verbosity)
    return `${model.slug} does not offer adjustable response detail. Choose the model default or a different model.`;
  return "";
}

export function stepModelProblem(
  models: readonly ProviderModel[],
  shared: ModelProfile,
  step: StepModelSettings,
) {
  const profile = resolveModelProfile(shared, step);
  if (!step.team) return modelProfileProblem(models, profile);
  for (const role of researchRoles) {
    if (role.key === "editor") continue;
    const issue = modelProfileProblem(models, resolveModelProfile(profile, step.team[role.key]));
    if (issue) return `${role.label} · ${issue}`;
  }
  return "";
}

export function sessionModelProblem(
  models: readonly ProviderModel[],
  shared: ModelProfile,
  roles: Pick<Setup, "lead" | "researcher" | "editor">,
) {
  const missing = modelProfileProblem(models, { model: shared.model });
  if (missing) return missing;
  for (const { key, label } of researchRoles) {
    const issue = modelProfileProblem(models, resolveModelProfile(shared, roles[key]));
    if (issue) return `${label} · ${issue}`;
  }
  return "";
}
