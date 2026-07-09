import { exportToExcel, exportToPdf, type ExportColumn } from "../lib/export";

/** Excel + PDF export buttons for any tabular data set. */
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
      <button disabled={disabled} title="Export to Excel" onClick={() => exportToExcel(rows, columns, filename)}>
        ⤓ Excel
      </button>
      <button disabled={disabled} title="Export to PDF" onClick={() => exportToPdf(title ?? filename, rows, columns, filename)}>
        ⤓ PDF
      </button>
    </div>
  );
}
