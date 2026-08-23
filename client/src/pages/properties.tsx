import { useState, useCallback } from 'react';
import { useLocation, Link } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card.tsx';
import { Table, TableHead, TableBody, TableRow, TableHeader, TableCell } from '../components/ui/Table.tsx';
import { Pagination } from '../components/ui/Pagination.tsx';
import { Badge } from '../components/ui/Badge.tsx';
import { useProperties, usePropertySearch } from '../hooks/use-api.ts';
import { formatAcreage, formatNumber, truncate } from '../lib/format.ts';
import { Search, Filter, MapPin, Loader2 } from 'lucide-react';

const US_STATES = [
  { code: '', name: 'All States' },
  { code: 'AL', name: 'Alabama' },
  { code: 'AK', name: 'Alaska' },
  { code: 'AZ', name: 'Arizona' },
  { code: 'AR', name: 'Arkansas' },
  { code: 'CA', name: 'California' },
  { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' },
  { code: 'DE', name: 'Delaware' },
  { code: 'FL', name: 'Florida' },
  { code: 'GA', name: 'Georgia' },
  { code: 'HI', name: 'Hawaii' },
  { code: 'ID', name: 'Idaho' },
  { code: 'IL', name: 'Illinois' },
  { code: 'IN', name: 'Indiana' },
  { code: 'IA', name: 'Iowa' },
  { code: 'KS', name: 'Kansas' },
  { code: 'KY', name: 'Kentucky' },
  { code: 'LA', name: 'Louisiana' },
  { code: 'ME', name: 'Maine' },
  { code: 'MD', name: 'Maryland' },
  { code: 'MA', name: 'Massachusetts' },
  { code: 'MI', name: 'Michigan' },
  { code: 'MN', name: 'Minnesota' },
  { code: 'MS', name: 'Mississippi' },
  { code: 'MO', name: 'Missouri' },
  { code: 'MT', name: 'Montana' },
  { code: 'NE', name: 'Nebraska' },
  { code: 'NV', name: 'Nevada' },
  { code: 'NH', name: 'New Hampshire' },
  { code: 'NJ', name: 'New Jersey' },
  { code: 'NM', name: 'New Mexico' },
  { code: 'NY', name: 'New York' },
  { code: 'NC', name: 'North Carolina' },
  { code: 'ND', name: 'North Dakota' },
  { code: 'OH', name: 'Ohio' },
  { code: 'OK', name: 'Oklahoma' },
  { code: 'OR', name: 'Oregon' },
  { code: 'PA', name: 'Pennsylvania' },
  { code: 'RI', name: 'Rhode Island' },
  { code: 'SC', name: 'South Carolina' },
  { code: 'SD', name: 'South Dakota' },
  { code: 'TN', name: 'Tennessee' },
  { code: 'TX', name: 'Texas' },
  { code: 'UT', name: 'Utah' },
  { code: 'VT', name: 'Vermont' },
  { code: 'VA', name: 'Virginia' },
  { code: 'WA', name: 'Washington' },
  { code: 'WV', name: 'West Virginia' },
  { code: 'WI', name: 'Wisconsin' },
  { code: 'WY', name: 'Wyoming' },
];

export function Properties() {
  const [, navigate] = useLocation();
  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState({
    state: '',
    county: '',
    apn: '',
  });
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

  const { data, isLoading } = useProperties({
    page,
    limit: 20,
    state: filters.state || undefined,
    county: filters.county || undefined,
    apn: filters.apn || undefined,
  });

  const { data: searchResults, isLoading: searching } = usePropertySearch(debouncedSearch, 20);

  const properties = debouncedSearch ? searchResults?.data : data?.data;
  const pagination = debouncedSearch ? undefined : data?.pagination;

  const handleRowClick = (id: number) => {
    navigate(`/properties/${id}`);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Properties</h2>
          <p className="text-gray-600 mt-1">Manage and view all properties</p>
        </div>
        <div className="text-sm text-gray-500">
          {pagination && `${formatNumber(pagination.total)} total properties`}
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
                placeholder="Search by APN, county, or zip..."
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
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4 border-t border-gray-200">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">State</label>
                <select
                  value={filters.state}
                  onChange={(e) => {
                    setFilters({ ...filters, state: e.target.value });
                    setPage(1);
                  }}
                  className="input-field"
                >
                  {US_STATES.map((s) => (
                    <option key={s.code} value={s.code}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">County</label>
                <input
                  type="text"
                  placeholder="Filter by county..."
                  value={filters.county}
                  onChange={(e) => {
                    setFilters({ ...filters, county: e.target.value });
                    setPage(1);
                  }}
                  className="input-field"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">APN</label>
                <input
                  type="text"
                  placeholder="Filter by APN..."
                  value={filters.apn}
                  onChange={(e) => {
                    setFilters({ ...filters, apn: e.target.value });
                    setPage(1);
                  }}
                  className="input-field"
                />
              </div>
              <div className="sm:col-span-3 flex justify-end">
                <button
                  onClick={() => {
                    setFilters({ state: '', county: '', apn: '' });
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

      {/* Properties Table */}
      <Card>
        <CardHeader>
          <CardTitle>All Properties</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {(isLoading || searching) ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
            </div>
          ) : !properties?.length ? (
            <div className="text-center py-12 text-gray-500">
              <MapPin className="w-12 h-12 mx-auto text-gray-300 mb-3" />
              <p>No properties found</p>
              <p className="text-sm mt-1">Try adjusting your search or filters</p>
            </div>
          ) : (
            <>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableHeader>APN</TableHeader>
                    <TableHeader>State</TableHeader>
                    <TableHeader>County</TableHeader>
                    <TableHeader>ZIP</TableHeader>
                    <TableHeader className="text-right">Acres</TableHeader>
                    <TableHeader>Legal Description</TableHeader>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {properties.map((property) => (
                    <TableRow
                      key={property.id}
                      className="cursor-pointer"
                      onClick={() => handleRowClick(property.id)}
                    >
                      <TableCell>
                        <span className="font-medium text-blue-600 hover:underline">
                          {property.apn}
                        </span>
                      </TableCell>
                      <TableCell>
                        {property.state ? (
                          <Badge variant="secondary">{property.state}</Badge>
                        ) : (
                          '-'
                        )}
                      </TableCell>
                      <TableCell>{property.county || '-'}</TableCell>
                      <TableCell>{property.zip || '-'}</TableCell>
                      <TableCell className="text-right">
                        {formatAcreage(property.acres)}
                      </TableCell>
                      <TableCell className="max-w-xs truncate">
                        {truncate(property.legalDescription, 40)}
                      </TableCell>
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
