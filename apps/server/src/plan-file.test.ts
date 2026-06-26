import { describe, expect, it } from "vitest";
import { buildPlanLine, parsePlanSection } from "./plan-file.js";

describe("parsePlanSection", () => {
  const sample = `# 2026-06-24

## Plan
- [ ] 08:00 COFFEE — Morning routine
- [ ] 14:00 CAMP GEAR {work} {important}
- [x] Done task {personal}
`;

  it("parses checkboxes and tokens", () => {
    const items = parsePlanSection(sample, "2026-06-24");
    expect(items).toHaveLength(3);
    expect(items[0]!.title).toBe("COFFEE");
    expect(items[0]!.time).toBe("08:00");
    expect(items[0]!.description).toBe("Morning routine");
    expect(items[1]!.category).toBe("work");
    expect(items[1]!.important).toBe(true);
    expect(items[2]!.done).toBe(true);
    expect(items[2]!.category).toBe("personal");
  });

  it("returns empty when no plan section", () => {
    expect(parsePlanSection("# Day\n\n## Notes\n")).toEqual([]);
  });
});

describe("buildPlanLine", () => {
  it("serializes tokens", () => {
    const line = buildPlanLine(
      {
        time: "15:00",
        title: "REVIEW",
        category: "work",
        important: true,
        dueDate: "2026-06-25",
      },
      false,
    );
    expect(line).toContain("- [ ]");
    expect(line).toContain("15:00 REVIEW");
    expect(line).toContain("{work}");
    expect(line).toContain("{important}");
    expect(line).toContain("{date:2026-06-25}");
  });
});
