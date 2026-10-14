import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

const MM = 96 / 25.4;

/** Scales a certificate page drawn at true millimetre size down to the width of its frame. */
export function TemplateThumb({ widthMm, heightMm, children }: { widthMm: number; heightMm: number; children: ReactNode }) {
  const frame = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.3);
  useLayoutEffect(() => {
    const element = frame.current;
    if (!element) return;
    const update = () => setScale(element.clientWidth / (widthMm * MM));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [widthMm]);
  return (
    <div className="template-thumb" ref={frame} style={{ aspectRatio: `${widthMm} / ${heightMm}` }}>
      <div
        className="template-miniature"
        aria-hidden="true"
        style={{ width: `${widthMm}mm`, height: `${heightMm}mm`, transform: `scale(${scale})` }}
      >
        {children}
      </div>
    </div>
  );
}
