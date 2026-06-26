import type { PlanItem } from "@homebot/shared";
import { describe, expect, it } from "vitest";
import { enrichPlanItemMeta, sortPlanItems } from "./plan-sort.js";

function item(partial: Partial<PlanItem> & Pick<PlanItem, "index" | "title">): PlanItem {
  return {
    done: false,
    raw: "",
    ...partial,
  };
}

describe("sortPlanItems", () => {
  it("puts time-bound items first, then newest index", () => {
    const items = [
      item({ index: 0, title: "A" }),
      item({ index: 2, title: "B", time: "18:00" }),
      item({ index: 1, title: "C", time: "09:00" }),
    ];
    const sorted = sortPlanItems(items, "2026-06-24");
    expect(sorted.map((i) => i.title)).toEqual(["C", "B", "A"]);
  });
});

describe("enrichPlanItemMeta", () => {
  it("marks carry bands by days", () => {
    const orange = enrichPlanItemMeta(
      item({ index: 0, title: "X", carryFrom: "2026-06-23" }),
      "2026-06-24",
    );
    expect(orange.carryBand).toBe("orange");
    expect(orange.carriedDays).toBe(1);

    const red = enrichPlanItemMeta(
      item({ index: 0, title: "Y", carryFrom: "2026-06-22" }),
      "2026-06-24",
    );
    expect(red.carryBand).toBe("red");
    expect(red.carriedDays).toBe(2);
  });
});
