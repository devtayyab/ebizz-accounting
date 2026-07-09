export type SortDir = "asc" | "desc";

interface Props {
  label: string;
  col: string;
  sort: string;
  dir: SortDir;
  onSort: (col: string) => void;
  align?: "left" | "right";
}

/** A clickable <th> that toggles sort on its column and shows the active arrow. */
export function SortHeader({ label, col, sort, dir, onSort, align = "left" }: Props) {
  const active = sort === col;
  return (
    <th
      onClick={() => onSort(col)}
      style={{ cursor: "pointer", userSelect: "none", textAlign: align, whiteSpace: "nowrap" }}
      title={`Sort by ${label}`}
    >
      {label}
      <span style={{ opacity: active ? 0.9 : 0.25, marginLeft: 4 }}>
        {active ? (dir === "asc" ? "▲" : "▼") : "↕"}
      </span>
    </th>
  );
}
