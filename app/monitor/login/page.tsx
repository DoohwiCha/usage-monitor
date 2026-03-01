import { redirect } from "next/navigation";
import LoginForm from "@/components/monitor/LoginForm";
import { getSessionUser } from "@/lib/usage-monitor/server-auth";

export default async function MonitorLoginPage() {
  const user = await getSessionUser();
  if (user) {
    redirect("/monitor");
  }

  return (
    <main className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
        <h1 className="text-2xl font-black text-slate-900 mb-1">사용량 모니터 로그인</h1>
        <p className="text-sm font-medium text-slate-600 mb-4">
          4개 기본 계정부터 시작하고 최대 12개 계정까지 확장 가능합니다.
        </p>
        <LoginForm />
        <div className="mt-4 text-xs text-slate-500 font-medium">
          기본 계정은 `admin / admin1234` 입니다. 운영 시 `MONITOR_ADMIN_USER`, `MONITOR_ADMIN_PASS`, `MONITOR_SESSION_SECRET` 환경변수로 변경하세요.
        </div>
      </div>
    </main>
  );
}
