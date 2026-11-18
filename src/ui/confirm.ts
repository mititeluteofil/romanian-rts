/**
 * Make a destructive button ask for a second tap before it acts: the first tap
 * swaps its label to `confirmLabel` for `ms`, a second tap in that window confirms.
 * Works the same with mouse and touch, and needs no blocking `confirm()` dialog.
 */
export function armTwoTap(
  button: HTMLButtonElement,
  confirmLabel: string,
  onConfirm: () => void,
  signal?: AbortSignal,
  ms = 3000,
): void {
  const label = button.textContent ?? '';
  let timer = 0;
  const reset = (): void => {
    window.clearTimeout(timer);
    timer = 0;
    button.textContent = label;
    button.classList.remove('confirming');
  };
  button.addEventListener(
    'click',
    () => {
      if (timer) {
        reset();
        onConfirm();
        return;
      }
      button.textContent = confirmLabel;
      button.classList.add('confirming');
      timer = window.setTimeout(reset, ms);
    },
    { signal },
  );
  signal?.addEventListener('abort', reset, { once: true });
}
