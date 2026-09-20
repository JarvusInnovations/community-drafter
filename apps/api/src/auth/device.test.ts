import { describe, expect, it } from "bun:test";

import { DeviceCodeStore } from "./device.ts";

describe("DeviceCodeStore", () => {
  it("creates an 8-char user_code and finds the pending record by it", () => {
    const store = new DeviceCodeStore();
    const pending = store.create();
    expect(pending.userCode).toHaveLength(8);
    expect(store.findByUserCode(pending.userCode)?.deviceCode).toBe(pending.deviceCode);
    expect(store.get(pending.deviceCode)?.userCode).toBe(pending.userCode);
  });

  it("approve() binds an email; get() reflects it until expiry", () => {
    const store = new DeviceCodeStore();
    const pending = store.create();
    expect(store.get(pending.deviceCode)?.approvedEmail).toBeUndefined();

    expect(store.approve(pending.userCode, "jane@example.org")).toBe(true);
    expect(store.get(pending.deviceCode)?.approvedEmail).toBe("jane@example.org");
  });

  it("approve() returns false for an unknown user_code", () => {
    const store = new DeviceCodeStore();
    expect(store.approve("NOTREAL1", "jane@example.org")).toBe(false);
  });

  /**
   * `specs/api/auth.md`: "404 when expired or unknown." Uses a tiny TTL
   * rather than waiting out the real 15-minute window.
   */
  it("expires a pending code: both get() and findByUserCode() forget it", async () => {
    const store = new DeviceCodeStore();
    const pending = store.create(10);
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(store.get(pending.deviceCode)).toBeUndefined();
    expect(store.findByUserCode(pending.userCode)).toBeUndefined();
    expect(store.approve(pending.userCode, "jane@example.org")).toBe(false);
  });

  it("clear() drops every pending code", () => {
    const store = new DeviceCodeStore();
    const pending = store.create();
    store.clear();
    expect(store.get(pending.deviceCode)).toBeUndefined();
  });
});
