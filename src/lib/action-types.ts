// Result shape for server actions used with useActionState (safe for client imports).
export type ActionState = {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Record<string, string[]>;
  /** Changes on every result so client effects can react to repeat outcomes. */
  at?: number;
};

export const idle: ActionState = { status: "idle" };
