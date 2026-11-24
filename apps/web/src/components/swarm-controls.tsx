import { useRef } from "react";
import { initialSwarm, type ResearchBrief } from "@/lib/research-sessions";
import styles from "./research-desk.module.css";

type Props = { draft: ResearchBrief; update: (patch: Partial<ResearchBrief>) => void };

export function SwarmControls({ draft, update }: Props) {
  const priorSwarm = useRef<ResearchBrief["swarm"]>(null);
  const settings = draft.swarm && { ...initialSwarm, ...draft.swarm };
  function changeMode(useSwarm: boolean) {
    if (!useSwarm) priorSwarm.current = draft.swarm;
    update({ swarm: useSwarm ? (priorSwarm.current ?? initialSwarm) : null });
  }
  return (
    <>
      <label className={styles.fullField}>
        Team structure
        <select
          value={settings ? "swarm" : "standard"}
          onChange={(event) => changeMode(event.target.value === "swarm")}
        >
          <option value="standard">Single lead</option>
          <option value="swarm">Research swarm</option>
        </select>
      </label>
      {settings && (
        <>
          <label>
            Research leads
            <select
              value={settings.lead_count}
              onChange={(event) =>
                update({ swarm: { ...settings, lead_count: Number(event.target.value) } })
              }
            >
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label>
            Researchers per lead
            <input
              type="number"
              required
              min={1}
              max={20}
              step={1}
              value={settings.researchers_per_lead || ""}
              onChange={(event) =>
                update({
                  swarm: { ...settings, researchers_per_lead: event.target.valueAsNumber || 0 },
                })
              }
            />
          </label>
          <details
            open
            className={styles.swarmLimits}
            onInvalidCapture={(event) => {
              event.currentTarget.open = true;
            }}
          >
            <summary>
              Swarm limits · {settings.max_parallel} active{" "}
              {settings.max_parallel === 1 ? "slot" : "slots"}
            </summary>
            <div>
              <label>
                Active slots
                <input
                  type="number"
                  required
                  min={1}
                  max={20}
                  step={1}
                  value={settings.max_parallel || ""}
                  onChange={(event) =>
                    update({
                      swarm: { ...settings, max_parallel: event.target.valueAsNumber || 0 },
                    })
                  }
                />
              </label>
              <label>
                Turns per lead
                <input
                  type="number"
                  required
                  min={2}
                  max={12}
                  step={1}
                  value={settings.max_lead_turns || ""}
                  onChange={(event) =>
                    update({
                      swarm: { ...settings, max_lead_turns: event.target.valueAsNumber || 0 },
                    })
                  }
                />
              </label>
              <p>
                Leads share these slots for model and analyst work. Assigned researchers wait when
                all slots are occupied.
              </p>
              <p>
                Up to {settings.lead_count * settings.researchers_per_lead} researchers and{" "}
                {2 +
                  settings.lead_count * settings.max_lead_turns +
                  (settings.lead_count * settings.researchers_per_lead + 1) * draft.max_passes}{" "}
                model requests across the study.
              </p>
            </div>
          </details>
          <label className={styles.consultationConsent}>
            <input
              type="checkbox"
              checked={settings.allow_consultations}
              onChange={(event) =>
                update({ swarm: { ...settings, allow_consultations: event.target.checked } })
              }
            />
            Allow leads to ask for expert judgment
          </label>
        </>
      )}
    </>
  );
}
