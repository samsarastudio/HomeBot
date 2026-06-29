import { describe, expect, it } from "vitest";
import { PARTY_COLORS, pickPartyColors } from "./mood-presets.js";

describe("pickPartyColors", () => {
  it("returns one color per area from the party palette", () => {
    const colors = pickPartyColors(3);
    expect(colors).toHaveLength(3);
    for (const c of colors) {
      expect(PARTY_COLORS.some((p) => p[0] === c[0] && p[1] === c[1] && p[2] === c[2])).toBe(true);
    }
  });

  it("wraps when more areas than palette entries", () => {
    expect(pickPartyColors(PARTY_COLORS.length + 2)).toHaveLength(PARTY_COLORS.length + 2);
  });
});
