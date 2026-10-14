import { useEffect, type RefObject } from "react";

/**
 * Section entrances: each part rises into place once as its section enters the viewport,
 * staggered heading, then text, then picture. Content is visible without this script, and
 * reduced-motion visitors get the content with no travel.
 */
export function useReveal(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const element = root.current;
    if (!element || !("IntersectionObserver" in window)) return;
    const sections = [...element.querySelectorAll<HTMLElement>("section, article, footer, .cta-band")];
    for (const section of sections) {
      const parts = [...section.querySelectorAll<HTMLElement>("[data-reveal]")].filter(
        (part) => part.closest("section, article, footer, .cta-band") === section,
      );
      parts.forEach((part, index) => part.style.setProperty("--reveal-delay", `${index * 75}ms`));
    }
    element.classList.add("reveal-ready");
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("is-in");
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
    );
    element.querySelectorAll("[data-reveal], [data-shutter]").forEach((part) => observer.observe(part));
    return () => observer.disconnect();
  }, [root]);
}
