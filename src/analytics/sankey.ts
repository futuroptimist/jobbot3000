import type { OpportunityEvent } from "../domain/opportunity.js";
import { computeSankeyEdges as runtimeComputeSankeyEdges } from "./sankey.js";

export interface SankeyEdge {
  source: string;
  target: string;
  count: number;
}

export function computeSankeyEdges(events: OpportunityEvent[]): SankeyEdge[] {
  return runtimeComputeSankeyEdges(events as unknown as any[]);
}
