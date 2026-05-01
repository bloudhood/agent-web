import type { ToastItem } from '@web/ui/Toast.svelte';

function id() { return `t-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`; }

function createToastStore() {
  let items = $state<ToastItem[]>([]);
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  function dismiss(toastId: string) {
    items = items.filter((i) => i.id !== toastId);
    const t = timers.get(toastId);
    if (t) clearTimeout(t);
    timers.delete(toastId);
  }

  function push(item: Omit<ToastItem, 'id'>) {
    const next: ToastItem = { ...item, id: id() };
    items = [...items, next];
    const dur = next.durationMs ?? 4000;
    if (dur > 0) {
      const t = setTimeout(() => dismiss(next.id), dur);
      timers.set(next.id, t);
    }
  }

  return {
    get items() { return items; },
    push,
    dismiss,
    info(title: string, body?: string) { push({ tone: 'info', title, body }); },
    success(title: string, body?: string) { push({ tone: 'success', title, body }); },
    warning(title: string, body?: string) { push({ tone: 'warning', title, body }); },
    danger(title: string, body?: string) { push({ tone: 'danger', title, body }); },
  };
}

export const toastStore = createToastStore();
