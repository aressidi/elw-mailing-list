import { useState, useCallback } from 'react';
import { useLocation, Link } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card.tsx';
import { Table, TableHead, TableBody, TableRow, TableHeader, TableCell } from '../components/ui/Table.tsx';
import { Pagination } from '../components/ui/Pagination.tsx';
import { Badge } from '../components/ui/Badge.tsx';
import { useOwners, useOwnerSearch } from '../hooks/use-api.ts';
import { formatDate } from '../lib/format.ts';
import { Search, Filter, Users, Loader2 } from 'lucide-react';

const OWNER_TYPES = [
  { value: '', label: 'All Types' },
  { value: 'individual', label: 'Individual' },
  { value: 'company', label: 'Company' },
  { value: 'trust', label: 'Trust' },
  { value: 'llc', label: 'LLC' },
  { value: 'other', label: 'Other' },
];

export function Owners() {
  const [, navigate] = useLocation();
  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [ownerType, setOwnerType] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  // Debounced search
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    const timeout = setTimeout(() => {
      setDebouncedSearch(value);
      setPage(1);
    }, 300);
    return () => clearTimeout(timeout);
  }, []);

  const { data, isLoading } = useOwners({
    page,
    limit: 20,
  });

  const { data: searchResults, isLoading: searching } = useOwnerSearch(debouncedSearch, 20);

  // Filter by type client-side if needed (since API doesn't support it directly)
  let owners = debouncedSearch ? searchResults?.data : data?.data;
  if (ownerType && owners) {
    owners = owners.filter((o) => o.ownerType === ownerType);
  }

  const pagination = debouncedSearch ? undefined : data?.pagination;

  const handleRowClick = (id: number) => {
    navigate(`/owners/${id}`);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Owners</h2>
          <p className="text-gray-600 mt-1">Manage and view all property owners</p>
        </div>
        <div className="text-sm text-gray-500">
          {pagination && `${pagination.total} total owners`}
        </div>
      </div>

      {/* Search and Filter Bar */}
      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="flex gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                placeholder="Search by name..."
                value={searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="input-field pl-10"
              />
            </div>
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`btn-secondary flex items-center gap-2 ${showFilters ? 'bg-gray-100' : ''}`}
            >
              <Filter className="w-4 h-4" />
              Filters
            </button>
          </div>

          {showFilters && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t border-gray-200">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Owner Type</label>
                <select
                  value={ownerType}
                  onChange={(e) => {
                    setOwnerType(e.target.value);
                    setPage(1);
                  }}
                  className="input-field"
                >
                  {OWNER_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-end">
                <button
                  onClick={() => {
                    setOwnerType('');
                    setPage(1);
                  }}
                  className="text-sm text-blue-600 hover:text-blue-700"
                >
                  Clear filters
                </button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Owners Table */}
      <Card>
        <CardHeader>
          <CardTitle>All Owners</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {(isLoading || searching) ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
            </div>
          ) : !owners?.length ? (
            <div className="text-center py-12 text-gray-500">
              <Users className="w-12 h-12 mx-auto text-gray-300 mb-3" />
              <p>No owners found</p>
              <p className="text-sm mt-1">Try adjusting your search or filters</p>
            </div>
          ) : (
            <>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableHeader>Owner Name</TableHeader>
                    <TableHeader>Type</TableHeader>
                    <TableHeader>First Name</TableHeader>
                    <TableHeader>Last Name</TableHeader>
                    <TableHeader>Created</TableHeader>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {owners.map((owner) => (
                    <TableRow
                      key={owner.id}
                      className="cursor-pointer"
                      onClick={() => handleRowClick(owner.id)}
                    >
                      <TableCell>
                        <span className="font-medium text-blue-600 hover:underline">
                          {owner.ownerName}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{owner.ownerType}</Badge>
                      </TableCell>
                      <TableCell>{owner.firstName || '-'}</TableCell>
                      <TableCell>{owner.lastName || '-'}</TableCell>
                      <TableCell>{formatDate(owner.createdAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {pagination && pagination.totalPages > 1 && (
                <div className="p-4 border-t border-gray-200">
                  <Pagination
                    page={pagination.page}
                    totalPages={pagination.totalPages}
                    onPageChange={setPage}
                  />
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
