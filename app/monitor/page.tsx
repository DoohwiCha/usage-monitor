import MonitorDashboard from "@/components/monitor/MonitorDashboard";
import { requirePageAuth } from "@/lib/usage-monitor/server-auth";

export default async function MonitorOverviewPage() {
  const user = await requirePageAuth();
  return <MonitorDashboard username={user} />;
}
