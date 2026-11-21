import { useId } from "react";
import { modelSettingLabel } from "@/lib/model-settings";
import styles from "./capability-slider.module.css";

export type CapabilityProps<T extends string> = {
  label: string;
  value?: string | null;
  choices: readonly T[];
  advertisedDefault?: string | null;
  inherited?: string;
  inheritedLevel?: string | null;
  onChange: (value: T | null) => void;
  onModelDefault?: () => void;
  disabled?: boolean;
};

export function CapabilitySlider<T extends string>({
  label,
  value,
  choices,
  advertisedDefault,
  inherited,
  inheritedLevel,
  onChange,
  onModelDefault,
  disabled,
}: CapabilityProps<T>) {
  const id = useId();
  const explicit = !!value && value !== "model_default";
  const usingShared = !value && inherited !== undefined;
  const level = explicit ? value : (usingShared && inheritedLevel) || advertisedDefault;
  const index = choices.findIndex((choice) => choice === level);
  const unavailable = index < 0 && (explicit || (usingShared && !!inheritedLevel));
  const providerText = advertisedDefault
    ? `Model default · ${modelSettingLabel(advertisedDefault)}`
    : "Model default";
  const selectedText = explicit ? modelSettingLabel(value) : usingShared ? inherited : providerText;
  const visibleValue = unavailable ? `${selectedText} (unavailable)` : selectedText;
  const last = choices.length - 1;

  function choose(position: number) {
    const selected = choices[position];
    if (selected !== undefined && selected !== value) onChange(selected);
  }

  return (
    <div className={styles.control} role="group" aria-label={`${label} control`}>
      <div className={styles.heading}>
        <label htmlFor={id}>{label}</label>
        <span className={styles.value} data-unavailable={unavailable || undefined}>
          {visibleValue}
        </span>
      </div>
      <div className={styles.rail} data-unpositioned={index < 0 || undefined}>
        <input
          id={id}
          type="range"
          min={0}
          max={Math.max(0, last)}
          step={1}
          value={Math.max(0, index)}
          list={id + "-stops"}
          aria-valuetext={visibleValue}
          aria-invalid={unavailable || undefined}
          disabled={disabled || !choices.length}
          onChange={(event) => choose(event.currentTarget.valueAsNumber)}
          onPointerUp={(event) => {
            if (event.button === 0) choose(event.currentTarget.valueAsNumber);
          }}
          onKeyDown={(event) => {
            // A native range emits no change when its thumb is already on a stop.
            // Let the owner pin that level, including a model's only supported level.
            if (event.key === "Home" || event.key === "End") {
              event.preventDefault();
              choose(event.key === "Home" ? 0 : last);
            } else if (
              event.key === "Enter" ||
              event.key === " " ||
              (index < 0 && event.key.startsWith("Arrow"))
            ) {
              event.preventDefault();
              choose(Math.max(0, index));
            }
          }}
        />
        <datalist id={id + "-stops"}>
          {choices.map((choice, i) => (
            <option key={choice} value={i} label={modelSettingLabel(choice)} />
          ))}
        </datalist>
      </div>
      {choices.length ? (
        <div className={styles.ends} aria-hidden="true">
          <span>{modelSettingLabel(choices[0])}</span>
          {last > 0 && <span>{modelSettingLabel(choices[last])}</span>}
        </div>
      ) : (
        <p className={styles.empty}>No adjustable levels advertised</p>
      )}
      <div className={styles.sources}>
        {onModelDefault && (
          <button
            type="button"
            aria-label="Use shared setting"
            aria-pressed={usingShared}
            disabled={disabled}
            onClick={() => onChange(null)}
          >
            Shared
          </button>
        )}
        <button
          type="button"
          aria-label="Use model default"
          aria-pressed={!explicit && !usingShared}
          disabled={disabled}
          onClick={onModelDefault ?? (() => onChange(null))}
        >
          Model default
        </button>
      </div>
    </div>
  );
}
