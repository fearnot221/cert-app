/** This function is intentionally self-contained: Playwright evaluates exactly this implementation. */
export function fitCertificateText(root: ParentNode): string[] {
  const errors: string[] = [];
  for (const element of root.querySelectorAll<HTMLElement>('[data-cert-text]')) {
    const originalSize = Number(element.dataset.fontSize);
    const minimumSize = Number(element.dataset.minFontSize);
    element.style.fontSize = `${originalSize}pt`;
    element.removeAttribute('data-overflow');
    if (element.scrollHeight <= element.clientHeight + 1 && element.scrollWidth <= element.clientWidth + 1) continue;
    element.style.fontSize = `${minimumSize}pt`;
    if (element.scrollHeight > element.clientHeight + 1 || element.scrollWidth > element.clientWidth + 1) {
      element.dataset.overflow = 'true';
      errors.push(`文字「${element.dataset.elementId}」在最小 ${minimumSize} pt 仍超出文字框`);
      continue;
    }
    let low = minimumSize;
    let high = originalSize;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const middle = (low + high) / 2;
      element.style.fontSize = `${middle}pt`;
      if (element.scrollHeight > element.clientHeight + 1 || element.scrollWidth > element.clientWidth + 1) high = middle;
      else low = middle;
    }
    element.style.fontSize = `${Math.max(minimumSize, Math.floor(low * 4) / 4)}pt`;
  }
  return errors;
}
