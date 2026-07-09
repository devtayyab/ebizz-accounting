import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

export interface ExportColumn<T> {
  header: string;
  value: (row: T) => string | number;
}

/** Download the rows as an .xlsx workbook. */
export function exportToExcel<T>(rows: T[], columns: ExportColumn<T>[], filename: string) {
  const data = rows.map((r) => {
    const o: Record<string, string | number> = {};
    for (const c of columns) o[c.header] = c.value(r);
    return o;
  });
  const ws = XLSX.utils.json_to_sheet(data, { header: columns.map((c) => c.header) });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Data");
  XLSX.writeFile(wb, `${filename}.xlsx`);
}

/** Download the rows as a PDF table (landscape when there are many columns). */
export function exportToPdf<T>(title: string, rows: T[], columns: ExportColumn<T>[], filename: string) {
  const doc = new jsPDF({ orientation: columns.length > 6 ? "landscape" : "portrait" });
  doc.setFontSize(14);
  doc.text(title, 14, 16);
  autoTable(doc, {
    startY: 22,
    head: [columns.map((c) => c.header)],
    body: rows.map((r) => columns.map((c) => String(c.value(r)))),
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [43, 95, 107] },
  });
  doc.save(`${filename}.pdf`);
}
