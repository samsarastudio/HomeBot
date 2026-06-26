import { describe, expect, it } from "vitest";
import { getGreeting } from "./time";

describe("getGreeting", () => {
  it("returns morning between 5 and 11", () => {
    expect(getGreeting(new Date(2026, 5, 24, 8, 0))).toBe("GOOD MORNING");
  });

  it("returns afternoon between 12 and 16", () => {
    expect(getGreeting(new Date(2026, 5, 24, 14, 0))).toBe("GOOD AFTERNOON");
  });

  it("returns evening from 17 through 1:59 AM", () => {
    expect(getGreeting(new Date(2026, 5, 24, 18, 0))).toBe("GOOD EVENING");
    expect(getGreeting(new Date(2026, 5, 24, 1, 30))).toBe("GOOD EVENING");
  });

  it("returns night between 2 and 4:59 AM", () => {
    expect(getGreeting(new Date(2026, 5, 24, 3, 0))).toBe("GOOD NIGHT");
  });
});
