import '@tanstack/react-table';

declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    /** Right-align + tabular numerals (design handoff: numeric columns are right-aligned). */
    numeric?: boolean;
    /** Shown in the column-visibility popover under "Hidden by default". */
    hiddenByDefault?: boolean;
    /** Labelled `sensitive` wherever it appears (spec §0.5). */
    sensitive?: boolean;
    label?: string;
  }
}
