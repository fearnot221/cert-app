import type { TemplateDocument, TextElement } from "../../lib/types";

export type AlignmentGuide = { axis: "x" | "y"; position: number };

function anchors(element: TextElement, axis: "x" | "y") {
  const angle = element.rotation * Math.PI / 180;
  const extent = axis === "x"
    ? Math.abs(element.width * Math.cos(angle)) + Math.abs(element.height * Math.sin(angle))
    : Math.abs(element.width * Math.sin(angle)) + Math.abs(element.height * Math.cos(angle));
  const center = element[axis] + (axis === "x" ? element.width : element.height) / 2;
  return [center - extent / 2, center, center + extent / 2];
}

/** Positions are in mm; the caller converts a fixed screen-pixel tolerance at the current zoom. */
export function alignDraggedElement(
  document: TemplateDocument,
  element: TextElement,
  position: { x: number; y: number },
  tolerance: number,
) {
  const result = { ...position, guides: [] as AlignmentGuide[] };
  for (const axis of ["x", "y"] as const) {
    const pageSize = axis === "x" ? document.widthMm : document.heightMm;
    const max = Math.max(0, pageSize - (axis === "x" ? element.width : element.height));
    result[axis] = Math.round(Math.max(0, Math.min(max, position[axis])) * 10) / 10;
    const moving = anchors({ ...element, [axis]: result[axis] }, axis);
    const targets = [pageSize / 2, 0, pageSize, ...document.elements
      .filter((other) => other.id !== element.id)
      .flatMap((other) => anchors(other, axis))];
    let nearest: { delta: number; target: number } | undefined;
    for (const target of targets) {
      for (const anchor of moving) {
        const delta = target - anchor;
        const next = result[axis] + delta;
        if (next < 0 || next > max || Math.abs(delta) > tolerance) continue;
        if (!nearest || Math.abs(delta) < Math.abs(nearest.delta)) nearest = { delta, target };
      }
    }
    if (nearest) {
      result[axis] += nearest.delta;
      result.guides.push({ axis, position: nearest.target });
    }
  }
  return result;
}
