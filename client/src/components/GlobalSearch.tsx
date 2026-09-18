import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { Search, X, Loader2, MapPin, Users } from 'lucide-react';
import { useGlobalSearch, GlobalSearchProperty, GlobalSearchOwner } from '../hooks/use-api.ts';

const DEBOUNCE_MS = 275;
const MIN_CHARS = 2;

type ResultItem =
  | { kind: 'property'; item: GlobalSearchProperty }
  | { kind: 'owner'; item: GlobalSearchOwner };

export function GlobalSearch() {
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const [mobileExpanded, setMobileExpanded] = useState(false);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const isEligible = debouncedQuery.length >= MIN_CHARS;
  const { data, isFetching } = useGlobalSearch(debouncedQuery);

  const properties = isEligible ? data?.data.properties || [] : [];
  const owners = isEligible ? data?.data.owners || [] : [];
  const propertyCount = data?.counts.properties ?? properties.length;
  const ownerCount = data?.counts.owners ?? owners.length;

  const flatResults: ResultItem[] = [
    ...properties.map((item) => ({ kind: 'property' as const, item })),
    ...owners.map((item) => ({ kind: 'owner' as const, item })),
  ];

  useEffect(() => {
    setHighlightedIndex(0);
  }, [debouncedQuery, data]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
        setMobileExpanded(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function closeAndReset() {
    setOpen(false);
    setMobileExpanded(false);
    setQuery('');
    setDebouncedQuery('');
  }

  function handleSelect(result: ResultItem) {
    closeAndReset();
    navigate(result.kind === 'property' ? `/properties/${result.item.id}` : `/owners/${result.item.id}`);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (flatResults.length === 0) return;
      setHighlightedIndex((i) => (i + 1) % flatResults.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (flatResults.length === 0) return;
      setHighlightedIndex((i) => (i - 1 + flatResults.length) % flatResults.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const result = flatResults[highlightedIndex];
      if (result) handleSelect(result);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      inputRef.current?.blur();
    }
  }

  const showDropdown = open && query.length > 0;

  return (
    <div ref={containerRef} className="relative">
      {/* Mobile: icon that expands into the input */}
      <button
        type="button"
        aria-label="Search"
        className="p-2 text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-100 sm:hidden"
        onClick={() => {
          setMobileExpanded((v) => !v);
          setOpen(true);
          setTimeout(() => inputRef.current?.focus(), 0);
        }}
      >
        <Search className="w-5 h-5" />
      </button>

      <div
        className={`${
          mobileExpanded ? 'block' : 'hidden'
        } sm:block absolute sm:relative top-full right-0 sm:right-auto sm:top-auto mt-2 sm:mt-0 z-40 w-72`}
      >
        <div className="relative">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={handleKeyDown}
            placeholder="Search APN, owner name..."
            className="w-full text-sm pl-9 pr-8 py-2 border border-gray-300 rounded-lg bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white"
          />
          {query && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => {
                setQuery('');
                setDebouncedQuery('');
                inputRef.current?.focus();
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {showDropdown && (
          <div className="absolute left-0 right-0 mt-1 bg-white rounded-lg shadow-xl border border-gray-200 max-h-96 overflow-auto z-50">
            {query.trim().length < MIN_CHARS ? (
              <p className="px-4 py-3 text-sm text-gray-500">Type at least {MIN_CHARS} characters</p>
            ) : isFetching && !data ? (
              <div className="px-4 py-3 flex items-center gap-2 text-sm text-gray-500">
                <Loader2 className="w-4 h-4 animate-spin" />
                Searching...
              </div>
            ) : flatResults.length === 0 ? (
              <p className="px-4 py-3 text-sm text-gray-500">No results for &quot;{debouncedQuery}&quot;</p>
            ) : (
              <>
                {properties.length > 0 && (
                  <ResultGroup label="Properties" count={propertyCount} icon={<MapPin className="w-3.5 h-3.5" />}>
                    {properties.map((p, idx) => (
                      <ResultRow
                        key={`property-${p.id}`}
                        active={highlightedIndex === idx}
                        onClick={() => handleSelect({ kind: 'property', item: p })}
                      >
                        <span className="font-mono font-medium text-gray-900 truncate block">{p.apn}</span>
                        <p className="text-xs text-gray-500 truncate">
                          {[p.county, p.state].filter(Boolean).join(', ') || 'No location on file'}
                          {p.ownerName && <span> · {p.ownerName}</span>}
                        </p>
                      </ResultRow>
                    ))}
                  </ResultGroup>
                )}
                {owners.length > 0 && (
                  <ResultGroup label="Owners" count={ownerCount} icon={<Users className="w-3.5 h-3.5" />}>
                    {owners.map((o, idx) => {
                      const flatIdx = properties.length + idx;
                      return (
                        <ResultRow
                          key={`owner-${o.id}`}
                          active={highlightedIndex === flatIdx}
                          onClick={() => handleSelect({ kind: 'owner', item: o })}
                        >
                          <span className="font-medium text-gray-900 truncate block">{o.ownerName}</span>
                          <p className="text-xs text-gray-500 truncate capitalize">
                            {o.ownerType}
                            {(o.mailingCity || o.mailingState) && (
                              <span> · {[o.mailingCity, o.mailingState].filter(Boolean).join(', ')}</span>
                            )}
                          </p>
                        </ResultRow>
                      );
                    })}
                  </ResultGroup>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ResultGroup({
  label,
  count,
  icon,
  children,
}: {
  label: string;
  count: number;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="py-1">
      <div className="px-3 py-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500 bg-gray-50 sticky top-0">
        {icon}
        {label}
        <span className="text-gray-400 font-normal">({count})</span>
      </div>
      {children}
    </div>
  );
}

function ResultRow({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`w-full text-left px-3 py-2 border-b border-gray-50 last:border-b-0 transition-colors ${
        active ? 'bg-blue-50' : 'hover:bg-gray-50'
      }`}
    >
      {children}
    </button>
  );
}
