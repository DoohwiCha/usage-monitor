import { getDb } from "@/lib/usage-monitor/db";
import { logger } from "@/lib/usage-monitor/logger";

export function auditLog(
  action: string,
  opts?: {
    userId?: string;
    resourceType?: string;
    resourceId?: string;
    details?: string;
    ip?: string;
  },
): void {
  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO audit_log (user_id, action, resource_type, resource_id, details, ip_address)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      opts?.userId || null,
      action,
      opts?.resourceType || null,
      opts?.resourceId || null,
      opts?.details || null,
      opts?.ip || null,
    );
  } catch (err) {
    logger.error("Failed to write audit log", { action, error: String(err) });
  }
}
