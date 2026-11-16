/**
 * Deployment configuration read from Convex environment variables.
 *
 * - `SITE_URL`: the app's public origin (e.g. https://kuchsistent.vercel.app).
 *   Sign-in may only redirect back to it (and to localhost in development).
 * - `HOUSEHOLD_CREATOR_EMAILS`: comma-separated Google emails allowed to
 *   create a Household. Everyone else can only join with an Invite.
 */

const DEV_ORIGINS = ["http://localhost:3000"];

export function allowedRedirectOrigins(
  env: Record<string, string | undefined> = process.env,
): string[] {
  const origins = new Set(DEV_ORIGINS);
  for (const raw of (env.SITE_URL ?? "").split(",")) {
    const value = raw.trim();
    if (value) origins.add(new URL(value).origin);
  }
  return [...origins];
}

export function householdCreatorEmails(
  env: Record<string, string | undefined> = process.env,
): Set<string> {
  return new Set(
    (env.HOUSEHOLD_CREATOR_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * `EXTRACTION_MODELS`: comma-separated models that read Recipe photos, tried
 * in order (#2). `claude-*` models use `ANTHROPIC_API_KEY`, `gemini-*` models
 * use `GEMINI_API_KEY`. Unknown vendors are skipped.
 */
export const DEFAULT_EXTRACTION_MODELS = ["claude-sonnet-5-5", "gemini-3.8-flash"];

export type ExtractionVendor = "anthropic" | "google";

export function extractionVendor(model: string): ExtractionVendor | null {
  if (model.startsWith("claude-")) return "anthropic";
  if (model.startsWith("gemini-")) return "google";
  return null;
}

export function extractionModels(
  env: Record<string, string | undefined> = process.env,
): string[] {
  const models = (env.EXTRACTION_MODELS ?? "")
    .split(",")
    .map((m) => m.trim())
    .filter((m) => m && extractionVendor(m) !== null);
  return models.length ? [...new Set(models)] : DEFAULT_EXTRACTION_MODELS;
}

export function mayCreateHousehold(
  email: string | undefined,
  emailVerified: boolean,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (!email || !emailVerified) return false;
  return householdCreatorEmails(env).has(email.trim().toLowerCase());
}
