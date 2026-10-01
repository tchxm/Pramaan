import "../../styles/workspace.css";

export type ProvenanceActor = "engine" | "agent" | "human";

export interface ProvenanceChipProps {
  actor: ProvenanceActor;
}

const ACTOR_LABEL: Record<ProvenanceActor, string> = {
  engine: "Engine",
  agent: "Agent",
  human: "You",
};

/**
 * Authorship chip — the product's central claim is that verdicts come from
 * the engine, not the model, so every claim on screen carries one of these.
 * Engine = ink fill, Agent = ink outline (not filled), Human = amber fill.
 */
export function ProvenanceChip({ actor }: ProvenanceChipProps): JSX.Element {
  return <span className={`ws-provenance-chip ws-provenance-chip--${actor}`}>{ACTOR_LABEL[actor]}</span>;
}
