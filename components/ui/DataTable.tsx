'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  flexRender, getCoreRowModel, getFilteredRowModel, getPaginationRowModel,
  getSortedRowModel, useReactTable,
  type ColumnDef, type SortingState, type VisibilityState,
} from '@tanstack/react-table';
import { CaretDown, CaretUp, CaretUpDown } from '@phosphor-icons/react/dist/ssr';

/**
 * The one table on every list page. Data is fetched server-side and passed in
 * whole; sorting, filtering and pagination happen client-side against that JSON
 * so navigating a table never refetches (spec §0.2).
 */
export function DataTable<T>({
  data, columns, globalFilter, rowHref, initialVisibility, onVisibilityChange, pageSize = 50, empty,
}: {
  data: T[];
  columns: ColumnDef<T, unknown>[];
  globalFilter?: string;
  rowHref?: (row: T) => string;
  initialVisibility?: VisibilityState;
  onVisibilityChange?: (v: VisibilityState) => void;
  pageSize?: number;
  empty?: React.ReactNode;
}) {
  const router = useRouter();
  const [sorting, setSorting] = useState<SortingState>([]);
  const [visibility, setVisibility] = useState<VisibilityState>(initialVisibility ?? {});

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter: globalFilter ?? '', columnVisibility: visibility },
    onSortingChange: setSorting,
    onColumnVisibilityChange: (updater) => {
      const next = typeof updater === 'function' ? updater(visibility) : updater;
      setVisibility(next);
      onVisibilityChange?.(next);
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize } },
  });

  const rows = table.getRowModel().rows;
  if (rows.length === 0 && empty) return <>{empty}</>;

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="table table-dense">
          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => {
                  const sorted = header.column.getIsSorted();
                  const numeric = header.column.columnDef.meta?.numeric;
                  return (
                    <th key={header.id} className={numeric ? 'num' : undefined}>
                      {header.isPlaceholder ? null : header.column.getCanSort() ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className="inline-flex items-center gap-1 uppercase tracking-[0.08em]"
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {sorted === 'asc' ? <CaretUp size={11} /> :
                            sorted === 'desc' ? <CaretDown size={11} /> :
                            <CaretUpDown size={11} className="opacity-40" />}
                        </button>
                      ) : flexRender(header.column.columnDef.header, header.getContext())}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {rows.map((row) => {
              const href = rowHref?.(row.original);
              return (
                <tr
                  key={row.id}
                  className={href ? 'row-link' : undefined}
                  tabIndex={href ? 0 : undefined}
                  onClick={href ? () => router.push(href) : undefined}
                  onKeyDown={href ? (e) => { if (e.key === 'Enter') router.push(href); } : undefined}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className={cell.column.columnDef.meta?.numeric ? 'num' : undefined}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {table.getPageCount() > 1 && (
        <div className="mt-4 flex items-center justify-between text-[12px] text-neutral-500">
          <span>
            {table.getFilteredRowModel().rows.length} rows · page{' '}
            {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
          </span>
          <span className="flex gap-2">
            <button className="btn btn-secondary" onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}>Previous</button>
            <button className="btn btn-secondary" onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}>Next</button>
          </span>
        </div>
      )}
    </div>
  );
}

/** Column visibility is opt-in per page; the table exposes its instance through this hook shape. */
export type { ColumnDef, VisibilityState };
