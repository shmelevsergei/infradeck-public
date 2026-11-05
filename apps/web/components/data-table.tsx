"use client";
import { useState } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  type SortingState,
} from "@tanstack/react-table";
import { ArrowUpDown, Columns3 } from "lucide-react";
import { useTranslate } from "./locale";
export function DataTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: (string | number)[][];
}) {
  const t = useTranslate();
  const [sorting, setSorting] = useState<SortingState>([]),
    [visibility, setVisibility] = useState({});
  const table = useReactTable<(string | number)[]>({
    data: rows,
    columns: headers.map((h, i) => ({
      id: String(i),
      accessorFn: (r) => r[i],
      header: t(h),
    })),
    state: { sorting, columnVisibility: visibility },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });
  return (
    <>
      <details className="column-picker">
        <summary>
          <Columns3 size={15} /> {t("Колонки / Columns")}
        </summary>
        {table.getAllLeafColumns().map((c) => (
          <label key={c.id}>
            <input
              type="checkbox"
              checked={c.getIsVisible()}
              onChange={c.getToggleVisibilityHandler()}
            />
            {String(c.columnDef.header)}
          </label>
        ))}
      </details>
      <div className="table-scroll">
        <table>
          <thead>
            {table.getHeaderGroups().map((g) => (
              <tr key={g.id}>
                {g.headers.map((h) => (
                  <th key={h.id}>
                    <button
                      className="table-sort"
                      onClick={h.column.getToggleSortingHandler()}
                    >
                      {flexRender(h.column.columnDef.header, h.getContext())}
                      <ArrowUpDown size={12} />
                    </button>
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((r) => (
              <tr key={r.id}>
                {r.getVisibleCells().map((c) => (
                  <td key={c.id}>
                    {flexRender(c.column.columnDef.cell, c.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <div className="empty">{t("Нет данных / No data")}</div>
        )}
      </div>
    </>
  );
}
