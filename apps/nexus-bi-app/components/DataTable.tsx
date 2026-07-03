"use client";

import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table";

interface DataTableProps {
  columnNames: string[];
  rows: Array<Record<string, unknown>>;
  sortColumn?: string | null;
  sortDir?: "asc" | "desc";
  onSortChange?: (column: string) => void;
}

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

// Solo lectura: no hay celdas editables ni handlers de escritura acá a
// propósito — cualquier corrección va por el Centro de Correcciones
// (no implementado en este corte).
export function DataTable({ columnNames, rows, sortColumn, sortDir, onSortChange }: DataTableProps) {
  const columns: ColumnDef<Record<string, unknown>>[] = columnNames.map(name => ({
    id: name,
    accessorKey: name,
    header: name,
    cell: info => formatCellValue(info.getValue())
  }));

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel()
  });

  return (
    <div className="overflow-x-auto rounded-lg border" style={{ borderColor: "var(--border)" }}>
      <table className="w-full text-sm">
        <thead>
          <tr style={{ borderBottom: "1px solid var(--border)" }}>
            {table.getFlatHeaders().map(header => {
              const isSorted = sortColumn === header.column.id;
              return (
                <th
                  key={header.id}
                  className="whitespace-nowrap px-3 py-2 text-left font-medium select-none"
                  style={{ color: "var(--text-secondary)", cursor: onSortChange ? "pointer" : "default" }}
                  onClick={() => onSortChange?.(header.column.id)}
                >
                  {flexRender(header.column.columnDef.header, header.getContext())}
                  {isSorted ? (sortDir === "desc" ? " ↓" : " ↑") : ""}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {table.getRowModel().rows.length === 0 ? (
            <tr>
              <td colSpan={columnNames.length} className="px-3 py-6 text-center" style={{ color: "var(--text-muted)" }}>
                Sin resultados.
              </td>
            </tr>
          ) : (
            table.getRowModel().rows.map(row => (
              <tr key={row.id} style={{ borderBottom: "1px solid var(--gridline)" }}>
                {row.getVisibleCells().map(cell => (
                  <td
                    key={cell.id}
                    className="tabular-nums whitespace-nowrap px-3 py-2"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
