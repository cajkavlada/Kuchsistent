import type { QueryCtx } from "../_generated/server";

/** Whether this backend has the preview-only fake test sign-in turned on. */
export async function isTestMode(ctx: Pick<QueryCtx, "db">): Promise<boolean> {
  const row = await ctx.db.query("testMode").first();
  return row?.enabled === true;
}
