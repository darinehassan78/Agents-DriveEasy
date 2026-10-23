import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "@/components/auth/auth-forms";
import { PageSkeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Log in" };

export default function LoginPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
      <p className="mt-1 mb-6 text-sm text-muted">Log in to book cars and manage your rentals.</p>
      <Suspense fallback={<PageSkeleton label="Loading form" />}>
        <LoginForm />
      </Suspense>
    </>
  );
}
