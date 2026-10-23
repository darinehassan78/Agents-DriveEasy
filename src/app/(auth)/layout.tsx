import { Container } from "@/components/ui/page-header";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <Container className="flex justify-center py-10 sm:py-16">
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-sm sm:p-8">{children}</div>
    </Container>
  );
}
