import type { Metadata } from "next";
import { Suspense } from "react";
import { RegisterForm } from "@/components/auth/auth-forms";
import { PageSkeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Create account" };

export default function RegisterPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
      <p className="mt-1 mb-6 text-sm text-muted">You&apos;ll add your driver details and licence before your first booking.</p>
      <Suspense fallback={<PageSkeleton label="Loading form" />}>
        <RegisterForm />
      </Suspense>
    </>
  );
}
