// Tiny module-level toast store (pub/sub) so both React components and the
// React Query MutationCache can raise toasts without threading context.
export type ToastKind = "success" | "error" | "info";
export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

type Listener = (items: ToastItem[]) => void;

let items: ToastItem[] = [];
let listeners: Listener[] = [];
let seq = 1;

function emit() {
  for (const l of listeners) l(items);
}

export function subscribeToasts(l: Listener): () => void {
  listeners.push(l);
  l(items);
  return () => {
    listeners = listeners.filter((x) => x !== l);
  };
}

export function dismissToast(id: number) {
  items = items.filter((i) => i.id !== id);
  emit();
}

function push(kind: ToastKind, message: string) {
  const id = seq++;
  items = [...items, { id, kind, message }];
  emit();
  setTimeout(() => dismissToast(id), kind === "error" ? 6000 : 3500);
}

export const toast = {
  success: (m: string) => push("success", m),
  error: (m: string) => push("error", m),
  info: (m: string) => push("info", m),
};
