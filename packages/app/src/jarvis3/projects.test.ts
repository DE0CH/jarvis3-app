import { describe, expect, it } from "vitest";
import type { ProjectView } from "./api-types";
import {
  checkDraft,
  createRequest,
  draftFromProject,
  emptyDraft,
  projectSummary,
  repoFolder,
  toggleProject,
  updateRequest,
} from "./projects";

const project: ProjectView = {
  id: "p1",
  name: "Website",
  description: "",
  shared: false,
  roles: [],
  ownerId: "u1",
  repos: [{ url: "https://github.com/acme/site.git", ref: null, tokenSecret: "GH_TOKEN" }],
  secrets: [{ key: "GH_TOKEN", updatedAt: "x" }],
  canEdit: true,
  createdAt: "x",
  updatedAt: "x",
};

describe("project form", () => {
  it("checks names, keys, reserved keys, repo addresses and token references", () => {
    const d = { ...emptyDraft(), name: "Site" };
    expect(checkDraft({ ...d, name: " " })).toMatch(/name/);
    expect(
      checkDraft({
        ...d,
        secrets: [{ key: "bad key", value: "v", stored: false, removed: false }],
      }),
    ).toMatch(/valid name/);
    expect(
      checkDraft({
        ...d,
        secrets: [{ key: "JARVIS_X", value: "v", stored: false, removed: false }],
      }),
    ).toMatch(/set by Jarvis/);
    expect(
      checkDraft({ ...d, secrets: [{ key: "API", value: "", stored: false, removed: false }] }),
    ).toMatch(/Enter a value/);
    expect(
      checkDraft({
        ...d,
        repos: [{ url: "https://u:p@github.com/a/b", ref: "", tokenSecret: "" }],
      }),
    ).toMatch(/https address/);
    expect(
      checkDraft({
        ...d,
        repos: [{ url: "https://github.com/a/b", ref: "", tokenSecret: "NOPE" }],
      }),
    ).toMatch(/isn't one of/);
    expect(checkDraft({ ...d, shared: true })).toMatch(/role/);
    expect(
      checkDraft({
        ...d,
        repos: [{ url: "https://github.com/a/b", ref: "main", tokenSecret: "" }],
      }),
    ).toBeNull();
  });
  it("makes a create request with only typed values", () => {
    const d = {
      ...emptyDraft(),
      name: " Site ",
      repos: [{ url: "https://github.com/a/b", ref: "", tokenSecret: "T" }],
      secrets: [{ key: "T", value: "secret", stored: false, removed: false }],
    };
    expect(createRequest(d)).toEqual({
      name: "Site",
      description: "",
      repos: [{ url: "https://github.com/a/b", ref: null, tokenSecret: "T" }],
      secrets: { T: "secret" },
    });
    expect(createRequest({ ...d, shared: true, roles: ["staff"] })).toMatchObject({
      shared: true,
      roles: ["staff"],
    });
  });
  it("sends only changes: a typed value replaces, a removed stored secret is deleted", () => {
    const d = draftFromProject(project);
    expect(d.secrets[0]).toEqual({ key: "GH_TOKEN", value: "", stored: true, removed: false });
    expect(updateRequest(d, project)).toEqual({});
    expect(updateRequest({ ...d, secrets: [{ ...d.secrets[0]!, value: "new" }] }, project)).toEqual(
      { secrets: { GH_TOKEN: "new" } },
    );
    expect(
      updateRequest(
        {
          ...d,
          repos: [{ ...d.repos[0]!, tokenSecret: "" }],
          secrets: [{ ...d.secrets[0]!, removed: true }],
        },
        project,
      ),
    ).toEqual({
      repos: [{ url: project.repos[0]!.url, ref: null, tokenSecret: null }],
      secrets: { GH_TOKEN: null },
    });
  });
  it("summarises, names the workspace folder, and caps the picker", () => {
    expect(projectSummary(project)).toBe("1 repo · 1 secret");
    expect(repoFolder("https://github.com/acme/site.git")).toBe("site");
    expect(toggleProject(["a"], "a")).toEqual([]);
    expect(
      toggleProject(
        Array.from({ length: 10 }, (_, i) => String(i)),
        "x",
      ),
    ).toHaveLength(10);
  });
});
