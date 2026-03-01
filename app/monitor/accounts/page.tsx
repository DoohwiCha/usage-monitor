import AccountsManager from "@/components/monitor/AccountsManager";
import { requirePageAuth } from "@/lib/usage-monitor/server-auth";

export default async function MonitorAccountsPage() {
  await requirePageAuth();
  return <AccountsManager />;
}
