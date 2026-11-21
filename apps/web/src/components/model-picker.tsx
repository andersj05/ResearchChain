import { useCallback, useEffect, useState } from "react";
import { api, type ProviderStatus } from "@/lib/workflow";
import { CapabilitySlider, type CapabilityProps } from "./capability-slider";
import {
  hasModelOverride,
  modelSettingLabel,
  researchRoles,
  resolveModelProfile,
  type Effort,
  type ModelOverride,
  type ModelProfile,
  type StepModelSettings,
  type Verbosity,
} from "@/lib/model-settings";

export function useModelCatalog(enabled: boolean) {
  const [status, setStatus] = useState<ProviderStatus | null>(null);
  const [error, setError] = useState("");
  const [generation, setGeneration] = useState(0);
  const [loadedGeneration, setLoadedGeneration] = useState(-1);
  const refresh = useCallback(() => {
    setGeneration((value) => value + 1);
  }, []);
  useEffect(() => {
    if (!enabled) return;
    let current = true;
    api<ProviderStatus>("providers/chatgpt", undefined, 30000)
      .then((result) => {
        if (current) {
          setStatus(result);
          setError(result.error ?? "");
        }
      })
      .catch((cause: unknown) => {
        if (current) {
          setStatus(null);
          setError(cause instanceof Error ? cause.message : "Connection unavailable.");
        }
      })
      .finally(() => {
        if (current) setLoadedGeneration(generation);
      });
    return () => {
      current = false;
    };
  }, [enabled, generation]);
  return { status, error, loading: generation !== loadedGeneration, refresh };
}

export type ModelCatalog = ReturnType<typeof useModelCatalog>;

export function ModelPicker({
  label,
  catalog,
  value,
  inherited,
  inheritedLabel = "Workflow default",
  onChange,
  disabled,
}: {
  label: string;
  catalog: ModelCatalog;
  value: string;
  inherited?: string;
  inheritedLabel?: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const models = catalog.status?.models ?? [];
  const missing = value && !models.some((item) => item.slug === value);
  return (
    <label className="model-picker">
      {label}
      <select
        value={value}
        disabled={disabled || (!models.length && !(inherited && value))}
        onChange={(event) => onChange(event.target.value)}
      >
        {inherited && (
          <option value="">
            {inheritedLabel} · {inherited}
          </option>
        )}
        {missing && (
          <option value={value} disabled>
            {value}
            {models.length ? " (unavailable)" : ""}
          </option>
        )}
        {models.map((model) => (
          <option key={model.slug} value={model.slug}>
            {model.display_name === model.slug
              ? model.slug
              : `${model.display_name} · ${model.slug}`}
          </option>
        ))}
      </select>
    </label>
  );
}

function CapabilitySelect<T extends string>({
  label,
  value,
  choices,
  advertisedDefault,
  inherited,
  onChange,
  onModelDefault,
  disabled,
}: CapabilityProps<T>) {
  const defaultText = advertisedDefault
    ? `Model default · ${modelSettingLabel(advertisedDefault)}`
    : "Model default";
  const unsupported =
    value && value !== "model_default" && !choices.some((choice) => choice === value);
  return (
    <label className="model-picker">
      {label}
      <select
        value={value ?? ""}
        disabled={disabled || (!choices.length && !value && !onModelDefault)}
        onChange={(event) => {
          const selected = event.target.value;
          if (selected === "model_default") onModelDefault?.();
          else onChange(choices.find((choice) => choice === selected) ?? null);
        }}
      >
        <option value="">{inherited ?? defaultText}</option>
        {onModelDefault && <option value="model_default">{defaultText}</option>}
        {unsupported && (
          <option value={value} disabled>
            {modelSettingLabel(value)} (unavailable)
          </option>
        )}
        {choices.map((choice) => (
          <option key={choice} value={choice}>
            {modelSettingLabel(choice)}
          </option>
        ))}
      </select>
    </label>
  );
}

type OptionProps = {
  catalog: ModelCatalog;
  scope: string;
  disabled?: boolean;
  useSliders?: boolean;
} & (
  | {
      inherited?: undefined;
      settings: ModelProfile;
      onChange: (patch: Omit<ModelProfile, "model">) => void;
    }
  | {
      inherited: ModelProfile;
      inheritedLabel?: string;
      settings: ModelOverride;
      onChange: (patch: ModelOverride) => void;
    }
);

const effortOrder: readonly Effort[] = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
];

export function ModelOptionFields(props: OptionProps) {
  const { catalog, settings, inherited, disabled } = props;
  const model = catalog.status?.models?.find(
    (item) => item.slug === (settings.model || inherited?.model),
  );
  const reset = inherited ? props.onChange : undefined;
  const Control = props.useSliders ? CapabilitySlider : CapabilitySelect;
  const efforts = model?.reasoning_efforts ?? [];
  function inheritedText(value: string | null | undefined, advertised: string | null | undefined) {
    if (!inherited) return undefined;
    const label = "inheritedLabel" in props ? props.inheritedLabel : undefined;
    const detail = value
      ? modelSettingLabel(value)
      : advertised
        ? `Model default (${modelSettingLabel(advertised)})`
        : "Model default";
    return `${label ?? "Workflow setting"} · ${detail}`;
  }
  return (
    <div
      className="model-option-fields"
      role="group"
      aria-label={`${props.scope} response settings`}
    >
      <Control<Effort>
        label="Thinking effort"
        value={settings.reasoning_effort}
        choices={
          props.useSliders ? effortOrder.filter((level) => efforts.includes(level)) : efforts
        }
        advertisedDefault={model?.default_reasoning_effort}
        inherited={inheritedText(inherited?.reasoning_effort, model?.default_reasoning_effort)}
        inheritedLevel={inherited?.reasoning_effort}
        onChange={(reasoning_effort) => props.onChange({ reasoning_effort })}
        onModelDefault={reset && (() => reset({ reasoning_effort: "model_default" }))}
        disabled={disabled}
      />
      <Control<Verbosity>
        label="Response detail"
        value={settings.verbosity}
        choices={model?.supports_verbosity ? ["low", "medium", "high"] : []}
        advertisedDefault={model?.default_verbosity}
        inherited={inheritedText(inherited?.verbosity, model?.default_verbosity)}
        inheritedLevel={inherited?.verbosity}
        onChange={(verbosity) => props.onChange({ verbosity })}
        onModelDefault={reset && (() => reset({ verbosity: "model_default" }))}
        disabled={disabled}
      />
    </div>
  );
}

export function ModelOverrideFields({
  label,
  modelLabel,
  inherited,
  settings,
  catalog,
  onChange,
  inheritedLabel,
  disabled,
  useSliders,
}: {
  label: string;
  modelLabel: string;
  inherited: ModelProfile;
  settings?: ModelOverride | null;
  catalog: ModelCatalog;
  onChange: (patch: ModelOverride) => void;
  inheritedLabel?: string;
  disabled?: boolean;
  useSliders?: boolean;
}) {
  return (
    <div className="model-override-fields" role="group" aria-label={label}>
      <ModelPicker
        label={modelLabel}
        value={settings?.model ?? ""}
        inherited={inherited.model}
        inheritedLabel={inheritedLabel}
        catalog={catalog}
        disabled={disabled}
        onChange={(model) => onChange({ model: model || null })}
      />
      <ModelOptionFields
        scope={label}
        catalog={catalog}
        disabled={disabled}
        inherited={inherited}
        inheritedLabel={inheritedLabel}
        settings={settings ?? {}}
        useSliders={useSliders}
        onChange={onChange}
      />
    </div>
  );
}

type RoleKey = (typeof researchRoles)[number]["key"];

export function RoleModelSettings({
  shared,
  values,
  catalog,
  onChange,
  disabled,
  includeEditor = false,
  initiallyOpen = false,
  useSliders,
  inheritedLabel,
}: {
  shared: ModelProfile;
  values: Partial<Record<RoleKey, ModelOverride | null>>;
  catalog: ModelCatalog;
  onChange: (role: RoleKey, value: ModelOverride | null) => void;
  disabled?: boolean;
  includeEditor?: boolean;
  initiallyOpen?: boolean;
  useSliders?: boolean;
  inheritedLabel: string;
}) {
  const roles = includeEditor
    ? researchRoles
    : researchRoles.filter((role) => role.key !== "editor");
  const count = roles.filter(({ key }) => hasModelOverride(values[key])).length;
  return (
    <details className="role-model-settings" open={initiallyOpen || undefined}>
      <summary>Models by role{count > 0 && ` (${count} customized)`}</summary>
      {roles.map(({ key, label }) => (
        <div className="role-model-section" key={key}>
          <h4>{label}</h4>
          <ModelOverrideFields
            label={label}
            modelLabel={`${label} model`}
            inherited={shared}
            inheritedLabel={inheritedLabel}
            settings={values[key]}
            catalog={catalog}
            disabled={disabled}
            useSliders={useSliders}
            onChange={(patch) => {
              const next = { ...values[key], ...patch };
              onChange(key, hasModelOverride(next) ? next : null);
            }}
          />
        </div>
      ))}
    </details>
  );
}

export function StepModelFields({
  label,
  modelLabel,
  shared,
  step,
  catalog,
  onChange,
  disabled,
}: {
  label: string;
  modelLabel: string;
  shared: ModelProfile;
  step: StepModelSettings;
  catalog: ModelCatalog;
  onChange: (patch: StepModelSettings) => void;
  disabled?: boolean;
}) {
  const team = step.team;
  return (
    <div>
      <ModelOverrideFields
        label={label}
        modelLabel={modelLabel}
        inherited={shared}
        settings={step}
        catalog={catalog}
        onChange={onChange}
        disabled={disabled}
      />
      {team && (
        <RoleModelSettings
          shared={resolveModelProfile(shared, step)}
          values={team}
          catalog={catalog}
          disabled={disabled}
          inheritedLabel="Step setting"
          onChange={(role, value) => {
            if (role !== "editor") onChange({ team: { ...team, [role]: value } });
          }}
        />
      )}
    </div>
  );
}
