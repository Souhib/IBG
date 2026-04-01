import { describe, it, expect, beforeEach } from "vitest"
import {
  getStoredToken,
  getStoredRefreshToken,
  getStoredUserData,
  storeAuthData,
  clearAuthData,
  getTokenExpiry,
} from "./auth"

describe("auth token storage", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it("returns null when no token is stored", () => {
    expect(getStoredToken()).toBeNull()
    expect(getStoredRefreshToken()).toBeNull()
    expect(getTokenExpiry()).toBeNull()
    expect(getStoredUserData()).toBeNull()
  })

  it("stores and retrieves auth data", () => {
    storeAuthData("access-123", "refresh-456", 3600)

    expect(getStoredToken()).toBe("access-123")
    expect(getStoredRefreshToken()).toBe("refresh-456")
    expect(getTokenExpiry()).toBeGreaterThan(Date.now())
  })

  it("stores and retrieves user data", () => {
    storeAuthData("access-123", "refresh-456", 3600, { id: "user-1", username: "test" })

    const userData = getStoredUserData() as { id: string; username: string }
    expect(userData).toEqual({ id: "user-1", username: "test" })
  })

  it("handles corrupted JSON in user data gracefully", () => {
    localStorage.setItem("majlisna-user-data", "not-valid-json{")

    expect(getStoredUserData()).toBeNull()
  })

  it("clears all auth data", () => {
    storeAuthData("access-123", "refresh-456", 3600, { id: "user-1" })
    clearAuthData()

    expect(getStoredToken()).toBeNull()
    expect(getStoredRefreshToken()).toBeNull()
    expect(getTokenExpiry()).toBeNull()
    expect(getStoredUserData()).toBeNull()
  })

  it("calculates token expiry correctly", () => {
    const before = Date.now()
    storeAuthData("access", "refresh", 60)
    const after = Date.now()

    const expiry = getTokenExpiry()!
    expect(expiry).toBeGreaterThanOrEqual(before + 60000)
    expect(expiry).toBeLessThanOrEqual(after + 60000)
  })
})
