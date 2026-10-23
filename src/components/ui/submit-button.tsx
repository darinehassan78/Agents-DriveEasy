"use client";

import { useFormStatus } from "react-dom";
import type { ComponentProps } from "react";
import { buttonClasses, type ButtonSize, type ButtonVariant } from "./button";
import { Spinner } from "./spinner";

type Props = ComponentProps<"button"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  pendingLabel?: string;
};

/** Submit button that disables itself and shows a spinner while its form is pending. */
export function SubmitButton({ variant, size, className, children, pendingLabel, disabled, ...rest }: Props) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={buttonClasses(variant, size, className)}
      disabled={pending || disabled}
      aria-busy={pending}
      {...rest}
    >
      {pending && <Spinner className="size-4" />}
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}
