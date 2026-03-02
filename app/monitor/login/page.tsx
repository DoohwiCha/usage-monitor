import { redirect } from "next/navigation";
import LoginForm from "@/components/monitor/LoginForm";
import { getSessionUser } from "@/lib/usage-monitor/server-auth";

export default async function MonitorLoginPage() {
  const auth = await getSessionUser();
  if (auth) {
    redirect("/monitor");
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden surface-page dot-pattern">
      {/* Ambient glow blobs */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -left-40 w-80 h-80 rounded-full blur-3xl" style={{ backgroundColor: "color-mix(in srgb, var(--brand-claude) 10%, transparent)" }} />
        <div className="absolute -bottom-40 -right-40 w-96 h-96 rounded-full blur-3xl" style={{ backgroundColor: "color-mix(in srgb, var(--brand-openai) 8%, transparent)" }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] rounded-full blur-3xl" style={{ backgroundColor: "color-mix(in srgb, var(--brand-claude) 5%, transparent)" }} />
      </div>

      <LoginForm />
    </main>
  );
}
