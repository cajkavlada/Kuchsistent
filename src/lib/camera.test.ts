import { expect, test } from "vitest";
import { cameraErrorMessage, nativeCaptureWorks } from "./camera";

const WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0";
const ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

test("phones and iPads open their camera for capture", () => {
  expect(nativeCaptureWorks({ userAgent: ANDROID, maxTouchPoints: 5 })).toBe(true);
  expect(nativeCaptureWorks({ userAgent: WINDOWS, mobile: true, maxTouchPoints: 0 })).toBe(true);
  expect(nativeCaptureWorks({ userAgent: MAC, maxTouchPoints: 5 })).toBe(true);
});

test("Windows (even a touch tablet) and desktop Macs open the file picker", () => {
  expect(nativeCaptureWorks({ userAgent: WINDOWS, mobile: false, maxTouchPoints: 10 })).toBe(false);
  expect(nativeCaptureWorks({ userAgent: MAC, maxTouchPoints: 0 })).toBe(false);
});

test("camera errors get a Czech message", () => {
  expect(cameraErrorMessage(new DOMException("x", "NotAllowedError"))).toMatch(/přístup ke kameře/);
  expect(cameraErrorMessage(new DOMException("x", "NotFoundError"))).toMatch(/nenašel kameru/);
  expect(cameraErrorMessage(new Error("?"))).toBe("Kameru se nepodařilo spustit.");
});
