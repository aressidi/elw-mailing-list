import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Table, TableHead, TableBody, TableRow, TableHeader, TableCell } from './Table';
import { Pagination } from './Pagination';
import {
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Filter,
  X,
  Search,
  FilterX,
  Calendar,
  Hash,
  Type,
} from 'lucide-react';

export type SortDirection = 'asc' | 'desc' | null;

export interface SortState {
  columnId: string;
  direction: 'asc' | 'desc';
}

export type FilterType = 'text' | 'select' | 'number' | 'date';

export interface ColumnFilterState {
  type: FilterType;
  value?: string;
  min?: string | number;
  max?: string | number;
  startDate?: string;
  endDate?: string;
  selectedOption?: string;
}

export type ColumnFilters = Record<string, ColumnFilterState>;

export interface ColumnDef<T> {
  id: string;
  header: string;
  accessorKey?: keyof T;
  accessorFn?: (row: T) => any;
  cell?: (row: T) => React.ReactNode;
  enableSorting?: boolean;
  enableFiltering?: boolean;
  filterType?: FilterType;
  filterOptions?: Array<{ label: string; value: string }>;
  headerClassName?: string;
  cellClassName?: string;
  align?: 'left' | 'center' | 'right';
  comparator?: (a: T, b: T) => number;
  filterFn?: (row: T, filter: ColumnFilterState) => boolean;
}

interface DataTableProps<T> {
  data: T[];
  columns: ColumnDef<T>[];
  storageKey?: string; // Key for sessionStorage persistence
  serverSide?: boolean;
  // If serverSide is true, parent handles sorting & filtering via these callbacks:
  onSortChange?: (sort: SortState | null) => void;
  onFilterChange?: (filters: ColumnFilters) => void;
  // External pagination (e.g. server-side pagination)
  pagination?: {
    page: number;
    totalPages: number;
    onPageChange: (page: number) => void;
    total?: number;
  };
  // Client-side pagination pageSize (default 20, ignored if serverSide)
  pageSize?: number;
  onRowClick?: (row: T) => void;
  emptyIcon?: React.ReactNode;
  emptyText?: string;
  emptySubtext?: string;
  className?: string;
}

export function DataTable<T extends Record<string, any>>({
  data,
  columns,
  storageKey,
  serverSide = false,
  onSortChange,
  onFilterChange,
  pagination: serverPagination,
  pageSize = 20,
  onRowClick,
  emptyIcon,
  emptyText = 'No records found',
  emptySubtext = 'Try adjusting your filters or search criteria',
  className,
}: DataTableProps<T>) {
  // Load initial states from sessionStorage if available
  const [sortState, setSortState] = useState<SortState | null>(() => {
    if (storageKey && typeof window !== 'undefined') {
      try {
        const saved = sessionStorage.getItem(`${storageKey}_sort`);
        if (saved) return JSON.parse(saved);
      } catch (e) {
        // ignore
      }
    }
    return null;
  });

  const [columnFilters, setColumnFilters] = useState<ColumnFilters>(() => {
    if (storageKey && typeof window !== 'undefined') {
      try {
        const saved = sessionStorage.getItem(`${storageKey}_filters`);
        if (saved) return JSON.parse(saved);
      } catch (e) {
        // ignore
      }
    }
    return {};
  });

  const [clientPage, setClientPage] = useState(1);
  const [activeFilterPopover, setActiveFilterPopover] = useState<string | null>(null);

  // Sync to sessionStorage
  useEffect(() => {
    if (!storageKey || typeof window === 'undefined') return;
    try {
      if (sortState) {
        sessionStorage.setItem(`${storageKey}_sort`, JSON.stringify(sortState));
      } else {
        sessionStorage.removeItem(`${storageKey}_sort`);
      }
    } catch (e) {
      // ignore
    }
  }, [storageKey, sortState]);

  useEffect(() => {
    if (!storageKey || typeof window === 'undefined') return;
    try {
      if (Object.keys(columnFilters).length > 0) {
        sessionStorage.setItem(`${storageKey}_filters`, JSON.stringify(columnFilters));
      } else {
        sessionStorage.removeItem(`${storageKey}_filters`);
      }
    } catch (e) {
      // ignore
    }
  }, [storageKey, columnFilters]);

  // Handle Sort Change
  const handleSort = (columnId: string) => {
    let nextSort: SortState | null = null;
    if (!sortState || sortState.columnId !== columnId) {
      nextSort = { columnId, direction: 'asc' };
    } else if (sortState.direction === 'asc') {
      nextSort = { columnId, direction: 'desc' };
    } else {
      nextSort = null;
    }
    setSortState(nextSort);
    setClientPage(1);
    if (onSortChange) {
      onSortChange(nextSort);
    }
  };

  // Handle Filter Change for a Column
  const handleFilterUpdate = (columnId: string, filter: ColumnFilterState | null) => {
    setColumnFilters((prev) => {
      const next = { ...prev };
      if (!filter || isFilterEmpty(filter)) {
        delete next[columnId];
      } else {
        next[columnId] = filter;
      }
      if (onFilterChange) {
        onFilterChange(next);
      }
      return next;
    });
    setClientPage(1);
  };

  const handleClearAllFilters = () => {
    setColumnFilters({});
    setSortState(null);
    setClientPage(1);
    if (onFilterChange) onFilterChange({});
    if (onSortChange) onSortChange(null);
  };

  const hasActiveFilters = Object.keys(columnFilters).length > 0;
  const hasActiveSort = sortState !== null;

  // Client-side filtering & sorting
  const processedData = useMemo(() => {
    if (serverSide) return data;

    let result = [...data];

    // Apply Filters
    const filterEntries = Object.entries(columnFilters);
    if (filterEntries.length > 0) {
      result = result.filter((row) => {
        return filterEntries.every(([colId, filter]) => {
          const col = columns.find((c) => c.id === colId);
          if (!col) return true;

          if (col.filterFn) {
            return col.filterFn(row, filter);
          }

          const rawValue = col.accessorFn
            ? col.accessorFn(row)
            : col.accessorKey
            ? row[col.accessorKey]
            : row[colId];

          if (filter.type === 'text') {
            if (!filter.value) return true;
            if (rawValue === null || rawValue === undefined) return false;
            return String(rawValue)
              .toLowerCase()
              .includes(filter.value.toLowerCase().trim());
          }

          if (filter.type === 'select') {
            if (!filter.selectedOption) return true;
            if (rawValue === null || rawValue === undefined) return false;
            return String(rawValue).toLowerCase() === filter.selectedOption.toLowerCase();
          }

          if (filter.type === 'number') {
            const num = Number(rawValue);
            if (isNaN(num)) return false;
            if (filter.min !== undefined && filter.min !== '' && num < Number(filter.min)) return false;
            if (filter.max !== undefined && filter.max !== '' && num > Number(filter.max)) return false;
            return true;
          }

          if (filter.type === 'date') {
            if (!rawValue) return false;
            const rowTime = new Date(rawValue).getTime();
            if (isNaN(rowTime)) return false;

            if (filter.startDate) {
              const startTime = new Date(filter.startDate).getTime();
              if (rowTime < startTime) return false;
            }
            if (filter.endDate) {
              // Add full day to endDate
              const endTime = new Date(filter.endDate).getTime() + 86400000;
              if (rowTime > endTime) return false;
            }
            return true;
          }

          return true;
        });
      });
    }

    // Apply Sort
    if (sortState) {
      const col = columns.find((c) => c.id === sortState.columnId);
      if (col) {
        result.sort((a, b) => {
          if (col.comparator) {
            const cmp = col.comparator(a, b);
            return sortState.direction === 'asc' ? cmp : -cmp;
          }

          const valA = col.accessorFn
            ? col.accessorFn(a)
            : col.accessorKey
            ? a[col.accessorKey]
            : a[col.id];
          const valB = col.accessorFn
            ? col.accessorFn(b)
            : col.accessorKey
            ? b[col.accessorKey]
            : b[col.id];

          if (valA === valB) return 0;
          if (valA === null || valA === undefined) return 1;
          if (valB === null || valB === undefined) return -1;

          // Number comparison
          if (typeof valA === 'number' && typeof valB === 'number') {
            return sortState.direction === 'asc' ? valA - valB : valB - valA;
          }

          // Date check
          const dateA = Date.parse(valA);
          const dateB = Date.parse(valB);
          if (!isNaN(dateA) && !isNaN(dateB) && typeof valA === 'string' && (valA.includes('-') || valA.includes('/'))) {
            return sortState.direction === 'asc' ? dateA - dateB : dateB - dateA;
          }

          // String comparison
          const strA = String(valA).toLowerCase();
          const strB = String(valB).toLowerCase();
          const cmp = strA.localeCompare(strB, undefined, { numeric: true });
          return sortState.direction === 'asc' ? cmp : -cmp;
        });
      }
    }

    return result;
  }, [data, columns, columnFilters, sortState, serverSide]);

  // Paginated records if client-side
  const paginatedData = useMemo(() => {
    if (serverSide) return data;
    const start = (clientPage - 1) * pageSize;
    return processedData.slice(start, start + pageSize);
  }, [processedData, data, serverSide, clientPage, pageSize]);

  const totalPages = serverSide
    ? serverPagination?.totalPages || 1
    : Math.ceil(processedData.length / pageSize);

  const currentPage = serverSide ? serverPagination?.page || 1 : clientPage;

  const handlePageChange = (p: number) => {
    if (serverSide) {
      serverPagination?.onPageChange(p);
    } else {
      setClientPage(p);
    }
  };

  return (
    <div className={`space-y-3 ${className || ''}`}>
      {/* Active filters status banner */}
      {(hasActiveFilters || hasActiveSort) && (
        <div className="flex items-center justify-between bg-blue-50/70 border border-blue-200 text-blue-900 px-3.5 py-2 rounded-lg text-xs sm:text-sm">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold flex items-center gap-1.5 text-blue-800">
              <Filter className="w-3.5 h-3.5" />
              Active Filters & Sorting:
            </span>
            {hasActiveSort && (
              <span className="inline-flex items-center gap-1 bg-white px-2 py-0.5 rounded border border-blue-200 text-blue-700 font-medium">
                Sort: {columns.find((c) => c.id === sortState?.columnId)?.header || sortState?.columnId} (
                {sortState?.direction === 'asc' ? 'A → Z / Asc' : 'Z → A / Desc'})
                <button
                  onClick={() => setSortState(null)}
                  className="hover:text-red-500 ml-0.5"
                  title="Clear sort"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}
            {Object.entries(columnFilters).map(([colId, filter]) => {
              const col = columns.find((c) => c.id === colId);
              let desc = '';
              if (filter.type === 'text' && filter.value) desc = `"${filter.value}"`;
              else if (filter.type === 'select' && filter.selectedOption) {
                const opt = col?.filterOptions?.find((o) => o.value === filter.selectedOption);
                desc = opt ? opt.label : filter.selectedOption;
              } else if (filter.type === 'number') {
                if (filter.min !== undefined && filter.max !== undefined) desc = `${filter.min} - ${filter.max}`;
                else if (filter.min !== undefined) desc = `>= ${filter.min}`;
                else if (filter.max !== undefined) desc = `<= ${filter.max}`;
              } else if (filter.type === 'date') {
                if (filter.startDate && filter.endDate) desc = `${filter.startDate} to ${filter.endDate}`;
                else if (filter.startDate) desc = `From ${filter.startDate}`;
                else if (filter.endDate) desc = `To ${filter.endDate}`;
              }

              return (
                <span
                  key={colId}
                  className="inline-flex items-center gap-1 bg-white px-2 py-0.5 rounded border border-blue-200 text-blue-700 font-medium"
                >
                  {col?.header || colId}: {desc}
                  <button
                    onClick={() => handleFilterUpdate(colId, null)}
                    className="hover:text-red-500 ml-0.5"
                    title={`Clear ${col?.header || colId} filter`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              );
            })}
          </div>
          <button
            onClick={handleClearAllFilters}
            className="flex items-center gap-1 font-medium text-blue-700 hover:text-blue-900 bg-white hover:bg-blue-100 border border-blue-200 px-2.5 py-1 rounded text-xs transition-colors shrink-0 shadow-sm"
          >
            <FilterX className="w-3.5 h-3.5 text-blue-600" />
            Clear All
          </button>
        </div>
      )}

      {/* Table */}
      <div className="relative">
        <Table>
          <TableHead>
            <TableRow>
              {columns.map((col) => {
                const canSort = col.enableSorting !== false;
                const canFilter = col.enableFiltering !== false;
                const isSorted = sortState?.columnId === col.id;
                const isFiltered = !!columnFilters[col.id];

                return (
                  <TableHeader
                    key={col.id}
                    className={`${col.headerClassName || ''} ${
                      col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'
                    } select-none`}
                  >
                    <div
                      className={`inline-flex items-center gap-1.5 ${
                        col.align === 'right'
                          ? 'justify-end w-full'
                          : col.align === 'center'
                          ? 'justify-center w-full'
                          : 'justify-start'
                      }`}
                    >
                      {/* Column Header Title & Sort Button */}
                      {canSort ? (
                        <button
                          type="button"
                          onClick={() => handleSort(col.id)}
                          className="group inline-flex items-center gap-1.5 font-semibold text-gray-700 hover:text-gray-900 transition-colors focus:outline-none"
                          title={`Sort by ${col.header}`}
                        >
                          <span>{col.header}</span>
                          <span className="p-0.5 rounded hover:bg-gray-200/60 text-gray-400 group-hover:text-gray-700 transition-colors">
                            {isSorted ? (
                              sortState?.direction === 'asc' ? (
                                <ArrowUp className="w-3.5 h-3.5 text-blue-600 font-bold" />
                              ) : (
                                <ArrowDown className="w-3.5 h-3.5 text-blue-600 font-bold" />
                              )
                            ) : (
                              <ArrowUpDown className="w-3.5 h-3.5 opacity-50 group-hover:opacity-100" />
                            )}
                          </span>
                        </button>
                      ) : (
                        <span>{col.header}</span>
                      )}

                      {/* Column Filter Toggle Button */}
                      {canFilter && (
                        <div className="relative inline-block text-left">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveFilterPopover(
                                activeFilterPopover === col.id ? null : col.id
                              );
                            }}
                            className={`p-1 rounded transition-colors focus:outline-none ${
                              isFiltered
                                ? 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                                : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100'
                            }`}
                            title={`Filter by ${col.header}`}
                          >
                            <Filter className="w-3.5 h-3.5" />
                          </button>

                          {activeFilterPopover === col.id && (
                            <ColumnFilterPopover
                              column={col}
                              currentFilter={columnFilters[col.id]}
                              onApply={(filter) => {
                                handleFilterUpdate(col.id, filter);
                                setActiveFilterPopover(null);
                              }}
                              onClear={() => {
                                handleFilterUpdate(col.id, null);
                                setActiveFilterPopover(null);
                              }}
                              onClose={() => setActiveFilterPopover(null)}
                            />
                          )}
                        </div>
                      )}
                    </div>
                  </TableHeader>
                );
              })}
            </TableRow>
          </TableHead>
          <TableBody>
            {paginatedData.length === 0 ? (
              <TableRow>
                <TableCell className="text-center py-12 text-gray-500" colSpan={columns.length}>
                  {emptyIcon && <div className="mb-3 flex justify-center text-gray-300">{emptyIcon}</div>}
                  <p className="font-medium text-gray-700">{emptyText}</p>
                  <p className="text-sm text-gray-500 mt-1">{emptySubtext}</p>
                  {(hasActiveFilters || hasActiveSort) && (
                    <button
                      onClick={handleClearAllFilters}
                      className="mt-3 text-sm text-blue-600 hover:text-blue-700 font-medium underline"
                    >
                      Reset all filters
                    </button>
                  )}
                </TableCell>
              </TableRow>
            ) : (
              paginatedData.map((row, idx) => (
                <TableRow
                  key={(row as any).id || idx}
                  className={onRowClick ? 'cursor-pointer hover:bg-gray-50' : undefined}
                  onClick={() => onRowClick && onRowClick(row)}
                >
                  {columns.map((col) => {
                    const cellContent = col.cell
                      ? col.cell(row)
                      : col.accessorFn
                      ? col.accessorFn(row)
                      : col.accessorKey
                      ? row[col.accessorKey]
                      : row[col.id];

                    return (
                      <TableCell
                        key={col.id}
                        className={`${col.cellClassName || ''} ${
                          col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'
                        }`}
                      >
                        {cellContent ?? '-'}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination Footer */}
      {totalPages > 1 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2 px-2 border-t border-gray-100">
          <div className="text-xs text-gray-500">
            Showing{' '}
            <span className="font-medium">
              {processedData.length === 0 ? 0 : (currentPage - 1) * pageSize + 1}
            </span>{' '}
            to{' '}
            <span className="font-medium">
              {Math.min(currentPage * pageSize, serverSide ? serverPagination?.total || 0 : processedData.length)}
            </span>{' '}
            of{' '}
            <span className="font-medium">
              {serverSide ? serverPagination?.total || 0 : processedData.length}
            </span>{' '}
            records
          </div>
          <Pagination
            page={currentPage}
            totalPages={totalPages}
            onPageChange={handlePageChange}
          />
        </div>
      )}
    </div>
  );
}

// Helper to check empty filter
function isFilterEmpty(filter: ColumnFilterState): boolean {
  if (filter.type === 'text') return !filter.value || filter.value.trim() === '';
  if (filter.type === 'select') return !filter.selectedOption || filter.selectedOption === '';
  if (filter.type === 'number') {
    return (
      (filter.min === undefined || filter.min === '') &&
      (filter.max === undefined || filter.max === '')
    );
  }
  if (filter.type === 'date') return !filter.startDate && !filter.endDate;
  return true;
}

interface ColumnFilterPopoverProps<T> {
  column: ColumnDef<T>;
  currentFilter?: ColumnFilterState;
  onApply: (filter: ColumnFilterState | null) => void;
  onClear: () => void;
  onClose: () => void;
}

function ColumnFilterPopover<T>({
  column,
  currentFilter,
  onApply,
  onClear,
  onClose,
}: ColumnFilterPopoverProps<T>) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const filterType = column.filterType || (column.filterOptions ? 'select' : 'text');

  const [textVal, setTextVal] = useState(currentFilter?.value || '');
  const [selectedOpt, setSelectedOpt] = useState(currentFilter?.selectedOption || '');
  const [minVal, setMinVal] = useState(currentFilter?.min?.toString() || '');
  const [maxVal, setMaxVal] = useState(currentFilter?.max?.toString() || '');
  const [startDate, setStartDate] = useState(currentFilter?.startDate || '');
  const [endDate, setEndDate] = useState(currentFilter?.endDate || '');

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (filterType === 'text') {
      if (!textVal.trim()) onClear();
      else onApply({ type: 'text', value: textVal.trim() });
    } else if (filterType === 'select') {
      if (!selectedOpt) onClear();
      else onApply({ type: 'select', selectedOption: selectedOpt });
    } else if (filterType === 'number') {
      if (minVal === '' && maxVal === '') onClear();
      else onApply({ type: 'number', min: minVal === '' ? undefined : Number(minVal), max: maxVal === '' ? undefined : Number(maxVal) });
    } else if (filterType === 'date') {
      if (!startDate && !endDate) onClear();
      else onApply({ type: 'date', startDate: startDate || undefined, endDate: endDate || undefined });
    }
  };

  return (
    <div
      ref={popoverRef}
      className="absolute left-0 mt-2 w-64 bg-white rounded-lg shadow-xl border border-gray-200 z-50 p-3 text-left font-normal normal-case text-gray-800"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between border-b border-gray-100 pb-2 mb-3">
        <span className="text-xs font-semibold text-gray-700 flex items-center gap-1">
          {filterType === 'text' && <Type className="w-3.5 h-3.5 text-gray-500" />}
          {filterType === 'number' && <Hash className="w-3.5 h-3.5 text-gray-500" />}
          {filterType === 'date' && <Calendar className="w-3.5 h-3.5 text-gray-500" />}
          Filter {column.header}
        </span>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 rounded p-0.5 hover:bg-gray-100"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        {/* Text Filter */}
        {filterType === 'text' && (
          <div>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-2.5" />
              <input
                type="text"
                autoFocus
                placeholder={`Search ${column.header}...`}
                value={textVal}
                onChange={(e) => setTextVal(e.target.value)}
                className="w-full text-xs pl-8 pr-2.5 py-1.5 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <p className="text-[11px] text-gray-400 mt-1">Contains text match</p>
          </div>
        )}

        {/* Select Filter */}
        {filterType === 'select' && (
          <div>
            <select
              value={selectedOpt}
              onChange={(e) => setSelectedOpt(e.target.value)}
              className="w-full text-xs px-2.5 py-1.5 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
            >
              <option value="">All {column.header}s</option>
              {column.filterOptions?.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Number Filter */}
        {filterType === 'number' && (
          <div className="space-y-2">
            <div>
              <label className="block text-[11px] font-medium text-gray-600 mb-0.5">Min</label>
              <input
                type="number"
                step="any"
                placeholder="Min value"
                value={minVal}
                onChange={(e) => setMinVal(e.target.value)}
                className="w-full text-xs px-2.5 py-1.5 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-600 mb-0.5">Max</label>
              <input
                type="number"
                step="any"
                placeholder="Max value"
                value={maxVal}
                onChange={(e) => setMaxVal(e.target.value)}
                className="w-full text-xs px-2.5 py-1.5 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>
        )}

        {/* Date Filter */}
        {filterType === 'date' && (
          <div className="space-y-2">
            <div>
              <label className="block text-[11px] font-medium text-gray-600 mb-0.5">From Date</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full text-xs px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-600 mb-0.5">To Date</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full text-xs px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between pt-2 border-t border-gray-100">
          <button
            type="button"
            onClick={onClear}
            className="text-xs text-gray-500 hover:text-red-600 transition-colors"
          >
            Reset
          </button>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={onClose}
              className="px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 rounded"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-2.5 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 font-medium"
            >
              Apply
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
