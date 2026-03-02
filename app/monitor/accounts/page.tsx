import AccountsManager from "@/components/monitor/AccountsManager";
import { requireAdminPageAuth } from "@/lib/usage-monitor/server-auth";

export default async function MonitorAccountsPage() {
  await requireAdminPageAuth();
  return <AccountsManager />;
}
