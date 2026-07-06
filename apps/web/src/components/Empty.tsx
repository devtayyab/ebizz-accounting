import type { ReactNode } from "react";

/** Centered empty-state content for use inside a table cell (colSpan the row). */
export function EmptyCell({ children }: { children: ReactNode }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">📭</div>
      <div className="empty-msg">{children ?? "Nothing here yet."}</div>
    </div>
  );
}
