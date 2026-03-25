import { describe, expect, it } from "vitest";

import { collapseSharedLocalOpenAIAccounts, getOpenAIIdentityDiagnostics } from "@/lib/usage-monitor/display";
import type { AccountUsageReport } from "@/lib/usage-monitor/types";

function makeOpenAIReport(
  accountId: string,
  name: string,
  sourceScope: "account" | "shared_local",
): AccountUsageReport {
  return {
    accountId,
    name,
    provider: "openai",
    status: "ok",
    costUsd: 0,
    requests: 0,
    tokens: 0,
    points: [],
    usageInfo: {
      windows: [{ label: "5h", utilization: 15, resetsAt: null }],
      sourceScope,
    },
  };
}

describe("collapseSharedLocalOpenAIAccounts", () => {
  it("collapses multiple shared-local OpenAI accounts into one display card", () => {
    const reports = [
      makeOpenAIReport("a-1", "Account 5", "shared_local"),
      makeOpenAIReport("a-2", "Account 6", "shared_local"),
      makeOpenAIReport("a-3", "API Account", "account"),
    ];

    const result = collapseSharedLocalOpenAIAccounts(reports, "Shared OpenAI (2)");

    expect(result.sharedLocalCount).toBe(2);
    expect(result.displayAccounts).toHaveLength(2);
    expect(result.displayAccounts[0]).toMatchObject({
      name: "Shared OpenAI (2)",
      provider: "openai",
    });
    expect(result.displayAccounts[0].accountId).toContain("shared-local-openai:");
    expect(result.displayAccounts[1].accountId).toBe("a-3");
  });

  it("leaves account-specific OpenAI cards unchanged when no collapse is needed", () => {
    const reports = [makeOpenAIReport("a-3", "API Account", "account")];

    const result = collapseSharedLocalOpenAIAccounts(reports, "Shared OpenAI (1)");

    expect(result.sharedLocalCount).toBe(0);
    expect(result.displayAccounts).toEqual(reports);
  });

  it("collapses duplicate account-scoped OpenAI profiles that resolve to the same account id", () => {
    const reports: AccountUsageReport[] = [
      {
        ...makeOpenAIReport("a-1", "Profile A", "account"),
        usageInfo: {
          windows: [{ label: "5h", utilization: 15, resetsAt: null }],
          sourceScope: "account",
          accountIdentity: { email: "dominic.d.cha@gmail.com", accountId: "acct-123", planType: "pro" },
        },
      },
      {
        ...makeOpenAIReport("a-2", "Profile B", "account"),
        usageInfo: {
          windows: [{ label: "5h", utilization: 15, resetsAt: null }],
          sourceScope: "account",
          accountIdentity: { email: "dominic.d.cha@gmail.com", accountId: "acct-123", planType: "pro" },
        },
      },
    ];

    const result = collapseSharedLocalOpenAIAccounts(reports, "Shared OpenAI (0)");

    expect(result.duplicateAccountScopedCount).toBe(2);
    expect(result.displayAccounts).toHaveLength(1);
    expect(result.displayAccounts[0].accountId).toContain("duplicate-openai-account:acct-123");
    expect(result.displayAccounts[0].name).toBe("dominic.d.cha@gmail.com");
  });

  it("builds duplicate diagnostics for account-scoped OpenAI profiles", () => {
    const reports: AccountUsageReport[] = [
      {
        ...makeOpenAIReport("a-1", "Profile A", "account"),
        usageInfo: {
          windows: [],
          sourceScope: "account",
          accountIdentity: { email: "dominic.d.cha@gmail.com", accountId: "acct-123", planType: "pro" },
        },
      },
      {
        ...makeOpenAIReport("a-2", "Profile B", "account"),
        usageInfo: {
          windows: [],
          sourceScope: "account",
          accountIdentity: { email: "dominic.d.cha@gmail.com", accountId: "acct-123", planType: "pro" },
        },
      },
    ];

    const diagnostics = getOpenAIIdentityDiagnostics(reports);

    expect(diagnostics.get("a-1")).toEqual({
      email: "dominic.d.cha@gmail.com",
      accountId: "acct-123",
      duplicateCount: 2,
    });
    expect(diagnostics.get("a-2")?.duplicateCount).toBe(2);
  });
});
