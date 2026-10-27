import { describe, expect, it } from "vitest";
import { createDefaultDocument } from "@cert/contracts";
import { alignDraggedElement } from "../../apps/web/src/features/templates/alignment";

const document = createDefaultDocument();
document.widthMm = 200;
document.heightMm = 150;
const moving = { ...document.elements[0]!, id: "moving", x: 20, y: 20, width: 40, height: 20 };
const other = { ...moving, id: "other", x: 130, y: 90, width: 30, height: 40 };
document.elements = [moving, other];

describe("drag alignment", () => {
  it("snaps to the page center and clears guides outside the tolerance", () => {
    expect(alignDraggedElement(document, moving, { x: 79, y: 64 }, 2)).toEqual({
      x: 80, y: 65, guides: [{ axis: "x", position: 100 }, { axis: "y", position: 75 }],
    });
    expect(alignDraggedElement(document, moving, { x: 75, y: 60 }, 2)).toEqual({ x: 75, y: 60, guides: [] });
  });

  it("aligns each edge and midpoint against another element", () => {
    for (const [x, target] of [[129, 130], [124, 145], [119, 160]]) {
      const result = alignDraggedElement(document, moving, { x: x!, y: 35 }, 1.5);
      expect(result.x).toBe(x! + 1);
      expect(result.guides).toContainEqual({ axis: "x", position: target });
    }
    const result = alignDraggedElement(document, moving, { x: 45, y: 89 }, 2);
    expect(result.y).toBe(90);
    expect(result.guides).toContainEqual({ axis: "y", position: 90 });
  });

  it("chooses the nearest alignment, excludes itself, and clamps to the page", () => {
    const nearby = { ...other, id: "nearby", x: 132.5 };
    expect(alignDraggedElement({ ...document, elements: [moving, other, nearby] }, moving, { x: 132, y: 35 }, 3).x).toBe(132.5);
    expect(alignDraggedElement({ ...document, elements: [moving] }, moving, { x: 21, y: 21 }, 2).guides).toEqual([]);
    expect(alignDraggedElement(document, moving, { x: -10, y: 300 }, 2)).toEqual({
      x: 0, y: 130, guides: [{ axis: "x", position: 0 }, { axis: "y", position: 150 }],
    });
  });

  it("uses the visible bounding box for rotated elements", () => {
    const rotated = { ...other, rotation: 90 };
    const result = alignDraggedElement({ ...document, elements: [moving, rotated] }, moving, { x: 124, y: 35 }, 1.5);
    expect(result.x).toBeCloseTo(125);
    expect(result.guides).toContainEqual({ axis: "x", position: 125 });
  });

  it("keeps the tolerance constant in screen pixels at different zoom levels", () => {
    for (const scale of [0.25, 0.5, 1]) {
      const pixelsPerMm = 96 / 25.4 * scale;
      const inside = alignDraggedElement(document, moving, { x: 80 - 4 / pixelsPerMm, y: 35 }, 5 / pixelsPerMm);
      expect(inside.x).toBe(80);
      const outside = alignDraggedElement(document, moving, { x: 80 - 7 / pixelsPerMm, y: 35 }, 5 / pixelsPerMm);
      expect(outside.guides).not.toContainEqual({ axis: "x", position: 100 });
    }
  });
});
