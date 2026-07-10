import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

export interface ExportColumn<T> {
  header: string;
  value: (row: T) => string | number;
}

/** Quote a CSV cell only when it contains a comma, quote, or newline. */
function csvCell(v: string | number): string {
  const s = String(v ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Download the rows as a .csv file (opens in Excel / Google Sheets). */
export function exportToCsv<T>(rows: T[], columns: ExportColumn<T>[], filename: string) {
  const header = columns.map((c) => csvCell(c.header)).join(",");
  const body = rows.map((r) => columns.map((c) => csvCell(c.value(r))).join(",")).join("\r\n");
  // Prepend a BOM so Excel detects UTF-8 (correct accents / currency symbols).
  const blob = new Blob(["﻿" + header + "\r\n" + body], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
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
