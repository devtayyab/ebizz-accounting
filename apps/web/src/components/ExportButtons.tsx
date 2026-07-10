import { exportToCsv, exportToPdf, type ExportColumn } from "../lib/export";

/** CSV + PDF export buttons for any tabular data set. */
export function ExportButtons<T>({
  rows,
  columns,
  filename,
  title,
}: {
  rows: T[];
  columns: ExportColumn<T>[];
  filename: string;
  title?: string;
}) {
  const disabled = !rows.length;
  return (
    <div style={{ display: "inline-flex", gap: 6 }}>
      <button disabled={disabled} title="Export to CSV" onClick={() => exportToCsv(rows, columns, filename)}>
        ⤓ CSV
      </button>
      <button disabled={disabled} title="Export to PDF" onClick={() => exportToPdf(title ?? filename, rows, columns, filename)}>
        ⤓ PDF
      </button>
    </div>
  );
}
