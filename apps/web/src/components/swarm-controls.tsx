import {
  expertReviewLabels,
  expertReviewMode,
  initialSwarm,
  type ResearchBrief,
} from "@/lib/research-sessions";

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
      <label>
        Expert judgment
        <select
          value={expertReviewMode(settings)}
          onChange={(event) =>
            update({
              swarm: {
                ...settings,
                allow_consultations: event.target.value !== "off",
                require_expert_judgment: event.target.value === "each_lead",
              },
            })
          }
        >
          {Object.entries(expertReviewLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}
