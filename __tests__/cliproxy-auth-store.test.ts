import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { scanCliProxyAuthStore } from "@/lib/usage-monitor/cliproxy-auth-store";

function makeJwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "RS256", typ: "JWT" })}.${encode(payload)}.sig`;
}

describe("scanCliProxyAuthStore", () => {
  const originalDir = process.env.CLIPROXY_AUTH_DIR;
  let authDir: string;

  beforeEach(() => {
    authDir = fs.mkdtempSync(path.join(os.tmpdir(), "cliproxy-auth-store-"));
    process.env.CLIPROXY_AUTH_DIR = authDir;
  });

  afterEach(() => {
    if (originalDir === undefined) {
      delete process.env.CLIPROXY_AUTH_DIR;
    } else {
      process.env.CLIPROXY_AUTH_DIR = originalDir;
    }
    fs.rmSync(authDir, { recursive: true, force: true });
  });

  it("returns codex and claude candidates from auth files", () => {
    fs.writeFileSync(path.join(authDir, "codex-test@example.com-pro.json"), JSON.stringify({
      access_token: makeJwt({ email: "test@example.com" }),
      account_id: "acct-123",
      email: "test@example.com",
      expired: "2026-04-01T00:00:00Z",
      id_token: makeJwt({
        email: "test@example.com",
        "https://api.openai.com/auth": {
          chatgpt_plan_type: "pro",
        },
      }),
    }));
    fs.writeFileSync(path.join(authDir, "claude-user@example.com.json"), JSON.stringify({
      access_token: "sk-ant-oat01-test",
      email: "user@example.com",
      expired: "2026-04-01T00:00:00Z",
    }));

    const candidates = scanCliProxyAuthStore();

    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toMatchObject({
      provider: "claude",
      syncSource: "cliproxy_claude",
      email: "user@example.com",
    });
    expect(candidates[1]).toMatchObject({
      provider: "openai",
      syncSource: "cliproxy_codex",
      email: "test@example.com",
      sourceAccountId: "acct-123",
      planType: "pro",
    });
  });
});
