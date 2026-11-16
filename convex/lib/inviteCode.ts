/**
 * Invite codes (#11): 6 characters shown as `XXX-XXX`, e.g. "K7M-2QX".
 * The alphabet leaves out look-alikes (0/O, 1/I/L) so a code read aloud or
 * typed on a phone keyboard survives. Shared by client and server.
 */

export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 6;

/** A fresh random code in display form. */
export function generateInviteCode(
  randomValues: (a: Uint32Array) => Uint32Array = (a) =>
    crypto.getRandomValues(a),
): string {
  const raw = randomValues(new Uint32Array(CODE_LENGTH));
  let code = "";
  for (const n of raw) code += CODE_ALPHABET[n % CODE_ALPHABET.length];
  return formatInviteCode(code);
}

function formatInviteCode(compact: string): string {
  return `${compact.slice(0, 3)}-${compact.slice(3)}`;
}

/**
 * What the person typed or pasted (a code in any case/spacing, or the whole
 * Invite link) → the code in display form, or null if it can't be one.
 */
export function normalizeInviteCode(input: string): string | null {
  let text = input.trim();
  const fromLink = /\/pozvanka\/([^/?#\s]+)/i.exec(text);
  if (fromLink) text = decodeURIComponent(fromLink[1]);
  const compact = text.toUpperCase().replace(/[\s-]/g, "");
  if (compact.length !== CODE_LENGTH) return null;
  for (const ch of compact) if (!CODE_ALPHABET.includes(ch)) return null;
  return formatInviteCode(compact);
}

/** Path of the Invite link for `code` (the app origin is added by the client). */
export function invitePath(code: string): string {
  return `/pozvanka/${code}`;
}
