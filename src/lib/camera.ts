/**
 * Taking a photo: phones open their camera app for
 * `<input type="file" capture>`, but desktop browsers (including Windows
 * tablets) ignore `capture` and open the file picker. There the app shows its
 * own camera view instead (getUserMedia).
 */

export type DeviceHints = {
  userAgent: string;
  /** `navigator.userAgentData?.mobile` where the browser has it. */
  mobile?: boolean;
  maxTouchPoints: number;
};

/** Whether `<input type="file" capture>` opens the camera on this device. */
export function nativeCaptureWorks({ userAgent, mobile, maxTouchPoints }: DeviceHints): boolean {
  if (mobile) return true;
  if (/Android|iPhone|iPad|iPod/i.test(userAgent)) return true;
  // iPadOS reports itself as a Mac; only a touch screen tells it apart.
  if (/Macintosh/.test(userAgent) && maxTouchPoints > 1) return true;
  return false;
}

/** The app's own camera view is used where `capture` doesn't work but getUserMedia does. */
export function wantsInAppCamera(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
  if (
    nativeCaptureWorks({
      userAgent: nav.userAgent,
      mobile: nav.userAgentData?.mobile,
      maxTouchPoints: nav.maxTouchPoints ?? 0,
    })
  ) {
    return false;
  }
  return typeof nav.mediaDevices?.getUserMedia === "function";
}

/** Czech message for a getUserMedia failure. */
export function cameraErrorMessage(err: unknown): string {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Prohlížeč nemá povolený přístup ke kameře. Povol ho v nastavení stránky (ikona zámku vedle adresy) a zkus to znovu.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "Na tomhle zařízení jsem nenašel kameru.";
  }
  if (name === "NotReadableError") {
    return "Kameru právě používá jiná aplikace. Zavři ji a zkus to znovu.";
  }
  return "Kameru se nepodařilo spustit.";
}
