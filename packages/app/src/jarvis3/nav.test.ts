import { describe, expect, it } from "vitest";
import { currentSection, routeKind, showsSidebar } from "./nav";

describe("routes", () => {
  it("tells top-level screens from pushed details", () => {
    expect(routeKind("/")).toBe("top");
    expect(routeKind("/chats/abc")).toBe("top");
    expect(routeKind("/files?dir=x")).toBe("top");
    expect(routeKind("/approvals/ap1")).toBe("detail");
    expect(routeKind("/projects/new")).toBe("detail");
    expect(routeKind("/me/notifications")).toBe("detail");
    expect(routeKind("/h/srv/workspace/1")).toBeNull();
  });
  it("shows the sidebar on wide windows everywhere, on phones only on top-level screens", () => {
    expect(showsSidebar({ pathname: "/approvals/ap1", compact: false, signedIn: true })).toBe(true);
    expect(showsSidebar({ pathname: "/approvals/ap1", compact: true, signedIn: true })).toBe(false);
    expect(showsSidebar({ pathname: "/", compact: true, signedIn: true })).toBe(true);
    expect(showsSidebar({ pathname: "/", compact: false, signedIn: false })).toBe(false);
  });
  it("highlights the sidebar entry a screen belongs to", () => {
    expect(currentSection("/")).toBe("new");
    expect(currentSection("/chats/x")).toBe("chats");
    expect(currentSection("/scheduled/s1")).toBe("scheduled");
    expect(currentSection("/me/layer")).toBeNull();
  });
});
