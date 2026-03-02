import MonitorDashboard from "@/components/monitor/MonitorDashboard";
import { requirePageAuth } from "@/lib/usage-monitor/server-auth";

export default async function MonitorOverviewPage() {
  const auth = await requirePageAuth();
  return <MonitorDashboard username={auth.user.username} />;
}
