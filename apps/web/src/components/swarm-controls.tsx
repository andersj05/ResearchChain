import { initialSwarm, type ResearchBrief } from "@/lib/research-sessions";
import styles from "./research-desk.module.css";

type Props = { draft: ResearchBrief; update: (patch: Partial<ResearchBrief>) => void };

export function SwarmControls({ draft, update }: Props) {
  if (!draft.swarm) return null;
  const settings = { ...initialSwarm, ...draft.swarm };

  return (
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
            update({ swarm: { ...settings, max_parallel: event.target.valueAsNumber || 0 } })
          }
        />
      </label>
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
  );
}
