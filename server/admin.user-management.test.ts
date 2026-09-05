import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

vi.mock("./db", () => ({
  changeUserRoleForAdmin: vi.fn(),
  listUsersForAdmin: vi.fn(),
}));

import * as db from "./db";
import { appRouter } from "./routers";

const mockedDb = vi.mocked(db);

function createContext(
  userId: number | null,
  role: "user" | "admin" = "user"
): TrpcContext {
  return {
    user:
      userId === null
        ? null
        : {
            id: userId,
            openId: `admin-test-${userId}`,
            name: `Admin Test ${userId}`,
            email: `admin-test-${userId}@example.com`,
            loginMethod: "test",
            role,
            createdAt: new Date("2026-01-01T00:00:00Z"),
            updatedAt: new Date("2026-01-02T00:00:00Z"),
            lastSignedIn: new Date("2026-01-03T00:00:00Z"),
          },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

const userSummary = {
  id: 22,
  name: "Target User",
  email: "target@example.com",
  role: "user" as const,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-02T00:00:00Z"),
  lastSignedIn: new Date("2026-01-03T00:00:00Z"),
};

describe("admin user management", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects unauthenticated user-management access", async () => {
    const caller = appRouter.createCaller(createContext(null));

    await expect(caller.admin.users()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(
      caller.admin.changeUserRole({ userId: 22, role: "admin" })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects normal users even when the frontend requests an admin action", async () => {
    const caller = appRouter.createCaller(createContext(7, "user"));

    await expect(caller.admin.users()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      caller.admin.changeUserRole({ userId: 22, role: "admin" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mockedDb.changeUserRoleForAdmin).not.toHaveBeenCalled();
  });

  it("allows an admin to list safe user details without provider credentials", async () => {
    mockedDb.listUsersForAdmin.mockResolvedValue([userSummary]);
    const caller = appRouter.createCaller(createContext(1, "admin"));

    const result = await caller.admin.users();

    expect(result).toEqual([userSummary]);
    expect(result[0]).not.toHaveProperty("openId");
    expect(result[0]).not.toHaveProperty("loginMethod");
    expect(result[0]).not.toHaveProperty("password");
  });

  it("allows an admin to change another user's role", async () => {
    mockedDb.changeUserRoleForAdmin.mockResolvedValue({
      ...userSummary,
      role: "admin",
    });
    const caller = appRouter.createCaller(createContext(1, "admin"));

    const result = await caller.admin.changeUserRole({
      userId: 22,
      role: "admin",
    });

    expect(mockedDb.changeUserRoleForAdmin).toHaveBeenCalledWith(22, "admin");
    expect(result).toMatchObject({ id: 22, role: "admin" });
  });

  it("prevents an administrator from changing their own role", async () => {
    const caller = appRouter.createCaller(createContext(1, "admin"));

    await expect(
      caller.admin.changeUserRole({ userId: 1, role: "user" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mockedDb.changeUserRoleForAdmin).not.toHaveBeenCalled();
  });
});
