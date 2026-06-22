import { describe, it, expect, vi, beforeEach } from "vitest";

const { sendNotification, isPermissionGranted, requestPermission } = vi.hoisted(() => ({
  sendNotification: vi.fn(),
  isPermissionGranted: vi.fn(),
  requestPermission: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-notification", () => ({ sendNotification, isPermissionGranted, requestPermission }));

import { notifyCompletion } from "./osNotify";
import type { Completion } from "./notifications";

const c: Completion = { id: "1", paneId: "p", sessionId: "s", tabId: "t", name: "fix-bug", project: "web", at: 1, seen: false };

beforeEach(() => { sendNotification.mockReset(); isPermissionGranted.mockReset(); requestPermission.mockReset(); isPermissionGranted.mockResolvedValue(true); });

describe("notifyCompletion", () => {
  it("sends with title=name, body=project", async () => {
    await notifyCompletion(c, { sound: false });
    expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({ title: "fix-bug", body: "web" }));
  });
  it("omits sound when sound:false, includes it when sound:true", async () => {
    await notifyCompletion(c, { sound: false });
    expect(sendNotification.mock.calls[0][0].sound).toBeUndefined();
    sendNotification.mockReset(); isPermissionGranted.mockResolvedValue(true);
    await notifyCompletion(c, { sound: true });
    expect(sendNotification.mock.calls[0][0].sound).toBe("default");
  });
  it("requests permission when not granted, and does not send if denied", async () => {
    isPermissionGranted.mockResolvedValue(false); requestPermission.mockResolvedValue("denied");
    await notifyCompletion(c, { sound: true });
    expect(sendNotification).not.toHaveBeenCalled();
  });
});
