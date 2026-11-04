let surface: HTMLElement | null = null;
export function bindEmbeddedSurface(element: HTMLElement | null) {surface = element;}
export function embeddedSurface() {return surface;}
export function embeddedViewport() {
  const rect = surface?.getBoundingClientRect();
  return {width: rect?.width ?? window.innerWidth, height: rect?.height ?? window.innerHeight,
    left: rect?.left ?? 0, top: rect?.top ?? 0, right: rect?.right ?? window.innerWidth};
}
export function observeEmbeddedViewport(element: HTMLElement) {
  const observer = new ResizeObserver(() => {
    const rect = element.getBoundingClientRect();
    element.style.setProperty('--xuelearn-host-width', `${rect.width}px`);
    element.style.setProperty('--xuelearn-host-height', `${rect.height}px`);
    window.dispatchEvent(new Event('resize'));
  });
  observer.observe(element);
  return () => observer.disconnect();
}
