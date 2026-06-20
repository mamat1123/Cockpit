/** Coalesce rapid calls into a single trailing run, `ms` after the last call.
 *
 *  Used to tame the ResizeObserver storm a drag produces: without this, every
 *  observer fire resized the PTY (a SIGWINCH flood) faster than the shell could
 *  redraw its prompt, leaving a cascade of duplicated/staircased prompt fragments.
 *  Debounced, the shell gets ONE clean resize at the settled size. */
export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  ms: number,
): ((...args: A) => void) & { cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const debounced = (...args: A) => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      fn(...args);
    }, ms);
  };
  debounced.cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  return debounced;
}
