import { useEffect, useState } from "react";
import { subscribeToasts, dismissToast, ToastItem } from "../lib/toast";

const ICON: Record<string, string> = { success: "✓", error: "✕", info: "i" };

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);
  useEffect(() => subscribeToasts(setItems), []);
  return (
    <div className="toast-wrap">
      {items.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`} onClick={() => dismissToast(t.id)}>
          <span className="toast-icon">{ICON[t.kind]}</span>
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  );
}
