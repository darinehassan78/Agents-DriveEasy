"use client";

import { ErrorPanel } from "@/components/error-panel";

export default function RootError({ error, retry }: { error: unknown; retry: () => void }) {
  return <ErrorPanel error={error} retry={retry} />;
}
