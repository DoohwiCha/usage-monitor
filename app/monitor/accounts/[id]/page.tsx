import AccountDetail from "@/components/monitor/AccountDetail";
import { requireAdminPageAuth } from "@/lib/usage-monitor/server-auth";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function MonitorAccountDetailPage({ params }: PageProps) {
  await requireAdminPageAuth();
  const { id } = await params;
  return <AccountDetail id={id} />;
}
