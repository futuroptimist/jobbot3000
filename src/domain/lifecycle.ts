import { z } from "zod";

import {
  applyLifecycleTransition as runtimeApplyLifecycleTransition,
  getAllowedTransitions as runtimeGetAllowedTransitions,
} from "./lifecycle.js";
import { lifecycleStateSchema as runtimeLifecycleStateSchema } from "./opportunity.js";

export const applyLifecycleTransition = runtimeApplyLifecycleTransition;
export const getAllowedTransitions = runtimeGetAllowedTransitions;
export const lifecycleStateSchema = runtimeLifecycleStateSchema;

export type LifecycleState = z.infer<typeof lifecycleStateSchema>;

export type LifecycleTransition = {
  from: LifecycleState;
  to: LifecycleState;
  occurredAt?: string | Date;
  note?: string;
};

export type LifecycleTransitionResult = ReturnType<
  typeof applyLifecycleTransition
>;
