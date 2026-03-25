import type { AccountUsageReport } from "@/lib/usage-monitor/types";

export interface OpenAIDisplayGroup {
  displayAccounts: AccountUsageReport[];
  sharedLocalCount: number;
  duplicateAccountScopedCount: number;
}

export interface OpenAIIdentityDiagnostic {
  email: string | null;
  accountId: string | null;
  duplicateCount: number;
}

export function getOpenAIIdentityDiagnostics(accounts: AccountUsageReport[]): Map<string, OpenAIIdentityDiagnostic> {
  const groups = new Map<string, AccountUsageReport[]>();

  for (const account of accounts) {
    const scopedAccountId = account.usageInfo?.accountIdentity?.accountId;
    if (!scopedAccountId) continue;
    const group = groups.get(scopedAccountId) || [];
    group.push(account);
    groups.set(scopedAccountId, group);
  }

  const diagnostics = new Map<string, OpenAIIdentityDiagnostic>();
  for (const [accountId, group] of groups.entries()) {
    const diagnostic: OpenAIIdentityDiagnostic = {
      email: group[0]?.usageInfo?.accountIdentity?.email || null,
      accountId,
      duplicateCount: group.length,
    };
    for (const account of group) {
      diagnostics.set(account.accountId, diagnostic);
    }
  }

  return diagnostics;
}

export function collapseSharedLocalOpenAIAccounts(
  accounts: AccountUsageReport[],
  sharedName: string,
): OpenAIDisplayGroup {
  const duplicateGroups = new Map<string, AccountUsageReport[]>();
  const untouchedAccounts: AccountUsageReport[] = [];

  for (const account of accounts) {
    const scopedAccountId = account.usageInfo?.sourceScope === "account"
      ? account.usageInfo.accountIdentity?.accountId
      : null;
    if (scopedAccountId) {
      const group = duplicateGroups.get(scopedAccountId) || [];
      group.push(account);
      duplicateGroups.set(scopedAccountId, group);
      continue;
    }
    untouchedAccounts.push(account);
  }

  const collapsedDuplicates: AccountUsageReport[] = [];
  let duplicateAccountScopedCount = 0;
  for (const [scopedAccountId, group] of duplicateGroups.entries()) {
    if (group.length <= 1) {
      collapsedDuplicates.push(group[0]);
      continue;
    }
    duplicateAccountScopedCount += group.length;
    const first = group[0];
    const email = first.usageInfo?.accountIdentity?.email;
    collapsedDuplicates.push({
      ...first,
      accountId: `duplicate-openai-account:${scopedAccountId}:${group.map((account) => account.accountId).sort().join(",")}`,
      name: email || `${first.name} (${group.length})`,
    });
  }

  const preparedAccounts = [...collapsedDuplicates, ...untouchedAccounts];
  const sharedLocalAccounts = accounts.filter((account) => account.usageInfo?.sourceScope === "shared_local");
  if (sharedLocalAccounts.length <= 1) {
    return {
      displayAccounts: preparedAccounts,
      sharedLocalCount: sharedLocalAccounts.length,
      duplicateAccountScopedCount,
    };
  }

  const firstShared = sharedLocalAccounts[0];
  const sharedAggregate: AccountUsageReport = {
    ...firstShared,
    accountId: `shared-local-openai:${sharedLocalAccounts.map((account) => account.accountId).sort().join(",")}`,
    name: sharedName,
  };

  return {
    displayAccounts: [
      sharedAggregate,
      ...preparedAccounts.filter((account) => account.usageInfo?.sourceScope !== "shared_local"),
    ],
    sharedLocalCount: sharedLocalAccounts.length,
    duplicateAccountScopedCount,
  };
}
