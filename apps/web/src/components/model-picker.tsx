import { useCallback, useEffect, useState } from "react";
import { api, type ProviderStatus } from "@/lib/workflow";

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
  onChange,
  disabled,
}: {
  label: string;
  catalog: ModelCatalog;
  value: string;
  inherited?: string;
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
        {inherited && <option value="">Workflow default · {inherited}</option>}
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
