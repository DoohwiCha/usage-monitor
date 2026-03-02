/**
 * Auth module - bridges sessions, users, and cookie management.
 * Re-exports key functions for backward compatibility.
 */
import { validateSession, getSessionCookieName, createSession, revokeSession, revokeAllUserSessions } from "@/lib/usage-monitor/sessions";
import { authenticateUser, ensureAdminExists, getUserById } from "@/lib/usage-monitor/users";
import type { User } from "@/lib/usage-monitor/users";

export { getSessionCookieName } from "@/lib/usage-monitor/sessions";

export interface AuthResult {
  user: User;
  sessionId: string;
}

/**
 * Validate a session token and return the associated user.
 */
export function validateSessionToken(token: string | undefined | null): AuthResult | null {
  if (!token) return null;

  const session = validateSession(token);
  if (!session) return null;

  const user = getUserById(session.userId);
  if (!user) return null;

  return { user, sessionId: session.id };
}

/**
 * Authenticate with username/password. Returns session token + user on success.
 */
export async function login(username: string, password: string, ip?: string, userAgent?: string): Promise<{ token: string; user: User } | null> {
  await ensureAdminExists();

  const user = await authenticateUser(username, password);
  if (!user) return null;

  const { token } = createSession(user.id, ip, userAgent);
  return { token, user };
}

/**
 * Revoke a session by token.
 */
export function logout(token: string): boolean {
  return revokeSession(token);
}

/**
 * Revoke all sessions for a user (e.g., after password change).
 */
export function logoutAll(userId: string): number {
  return revokeAllUserSessions(userId);
}
