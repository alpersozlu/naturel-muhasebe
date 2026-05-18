import { adminProcedure } from "../trpc";

type AuditAction =
  | "create"
  | "update"
  | "delete"
  | "restore"
  | "approve"
  | "lock"
  | "unlock"
  | "assign"
  | "unassign";

function inferAction(path: string): AuditAction {
  const last = path.split(".").pop() ?? "";
  if (last === "create") return "create";
  if (last === "update" || last === "updateRole") return "update";
  if (last === "softDelete") return "delete";
  if (last === "restore") return "restore";
  if (last === "assign") return "assign";
  if (last === "unassign") return "unassign";
  if (last === "approve") return "approve";
  if (last === "lock") return "lock";
  if (last === "unlock") return "unlock";
  return "update";
}

function extractEntityId(data: unknown): string | null {
  if (data && typeof data === "object" && "id" in data) {
    const id = (data as { id: unknown }).id;
    return typeof id === "string" ? id : null;
  }
  return null;
}

/**
 * Audit-logged admin procedure factory.
 *
 * Wraps adminProcedure with a middleware that, on successful mutations,
 * writes an AuditLog row with user_id, action (inferred from path),
 * entity_type, entity_id and the resulting after_json.
 *
 * Logging failures are swallowed (and logged to stderr) so they
 * never break the actual mutation.
 *
 * Usage:
 *   const brandAudited = withAudit("Brand");
 *   create: brandAudited.input(...).mutation(...)
 */
export function withAudit(entityType: string) {
  return adminProcedure.use(async ({ ctx, next, path, type }) => {
    const result = await next();
    if (type !== "mutation" || !result.ok) return result;

    try {
      await ctx.prisma.auditLog.create({
        data: {
          user_id: ctx.user.id,
          action: inferAction(path),
          entity_type: entityType,
          entity_id: extractEntityId(result.data),
          after_json: (result.data as object) ?? undefined,
        },
      });
    } catch (e) {
      console.error("[audit] log failed", { path, error: e });
    }

    return result;
  });
}
