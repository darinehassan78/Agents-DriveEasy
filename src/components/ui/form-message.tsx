import type { ActionState } from "@/lib/action-types";
import { Alert } from "./alert";

/** Shows an action's success or error message. */
export function FormMessage({ state, className }: { state: ActionState; className?: string }) {
  if (state.status === "idle" || !state.message) return null;
  return (
    <Alert tone={state.status === "success" ? "success" : "danger"} className={className}>
      {state.message}
    </Alert>
  );
}
