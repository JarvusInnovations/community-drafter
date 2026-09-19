import { beforeEach, describe, expect, it } from "bun:test";

import { CommentBuffer } from "./buffer.ts";

describe("CommentBuffer", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("stores, lists and clears entries scoped to one document/person", () => {
    const buffer = new CommentBuffer("coalition-charter", "jane-doe");
    buffer.set("c1", { body: "Hello", updatedAt: "2026-09-19T00:00:00Z" });
    buffer.set("c2", { body: "World", anchor: { quote: "x" }, updatedAt: "2026-09-19T00:00:01Z" });

    expect(buffer.get("c1")?.body).toBe("Hello");
    expect(buffer.list()).toHaveLength(2);

    buffer.clear("c1");
    expect(buffer.get("c1")).toBeUndefined();
    expect(buffer.list()).toHaveLength(1);
  });

  it("keeps separate people/documents isolated from each other", () => {
    const jane = new CommentBuffer("coalition-charter", "jane-doe");
    const john = new CommentBuffer("coalition-charter", "john-doe");
    jane.set("c1", { body: "Jane's note", updatedAt: "2026-09-19T00:00:00Z" });

    expect(john.get("c1")).toBeUndefined();
    expect(john.list()).toHaveLength(0);
  });

  it("survives a fresh instance over the same storage (simulating a reload)", () => {
    const first = new CommentBuffer("coalition-charter", "jane-doe");
    first.set("new-abc123", { body: "Not yet sent", updatedAt: "2026-09-19T00:00:00Z" });

    const second = new CommentBuffer("coalition-charter", "jane-doe");
    const restored = second.list();
    expect(restored).toHaveLength(1);
    expect(restored[0]?.entry.body).toBe("Not yet sent");
  });
});
