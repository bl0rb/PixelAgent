// @ts-check

/**
 * Shared rAF-throttled tracker for fixed-position overlay boxes that must
 * follow their target element's `getBoundingClientRect` (hover box,
 * selection box, remove markers, change-number badges). Centralizing this
 * avoids duplicating scroll/resize/MutationObserver wiring in every module
 * that draws a tracked box.
 * @param {() => void} onUpdate
 * @returns {{ update: () => void, destroy: () => void }}
 */
export function createPositionTracker(onUpdate) {
  const raf =
    typeof globalThis.requestAnimationFrame === 'function'
      ? globalThis.requestAnimationFrame.bind(globalThis)
      : /** @param {() => void} fn */ (fn) => setTimeout(fn, 16);

  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    raf(() => {
      scheduled = false;
      onUpdate();
    });
  };

  window.addEventListener('scroll', schedule, true);
  window.addEventListener('resize', schedule);

  let observer = null;
  if (typeof MutationObserver === 'function') {
    observer = new MutationObserver(schedule);
    observer.observe(document.documentElement, {
      attributes: true,
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  return {
    update: schedule,
    destroy() {
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
      if (observer) observer.disconnect();
    },
  };
}
