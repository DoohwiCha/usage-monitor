import type { MonitorAccount } from "@/lib/usage-monitor/types";
import { matchClaudeOAuthAccount } from "@/lib/usage-monitor/usage-adapters";

function makeAccount(id: string, name: string): MonitorAccount {
  return {
    id,
    name,
    provider: "claude",
    enabled: true,
    sessionCookie: "sid=test",
    createdAt: "2026-03-04T00:00:00.000Z",
    updatedAt: "2026-03-04T00:00:00.000Z",
  };
}

describe("matchClaudeOAuthAccount", () => {
  it("matches exact email account when similar local-part emails exist", () => {
    const accounts = [
      makeAccount("a1", "ociomirae@gmail.com"),
      makeAccount("a2", "ociomirae3@gmail.com"),
    ];

    const matched = matchClaudeOAuthAccount(accounts, "ociomirae3@gmail.com");

    expect(matched?.id).toBe("a2");
  });

  it("does not match by local-part prefix", () => {
    const accounts = [
      makeAccount("a1", "ociomirae@gmail.com"),
    ];

    const matched = matchClaudeOAuthAccount(accounts, "ociomirae3@gmail.com");

    expect(matched).toBeUndefined();
  });

  it("normalizes case and spaces before matching", () => {
    const accounts = [
      makeAccount("a1", "OCIOMIRAE3@GMAIL.COM"),
    ];

    const matched = matchClaudeOAuthAccount(accounts, "  ociomirae3@gmail.com  ");

    expect(matched?.id).toBe("a1");
  });
});
