import { useState } from 'react';
import { Link } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card.tsx';
import { Badge } from '../components/ui/Badge.tsx';
import { DataTable, ColumnDef } from '../components/ui/DataTable.tsx';
import { useSuppression, useAddSuppression, useOwners, useProperties, SuppressionRecord } from '../hooks/use-api.ts';
import { formatDate } from '../lib/format.ts';
import { Ban, Plus, Loader2, AlertCircle, CheckCircle, X } from 'lucide-react';

const REASON_OPTIONS = [
  { value: 'do_not_mail', label: 'Do Not Mail' },
  { value: 'bad_address', label: 'Bad Address' },
  { value: 'deceased', label: 'Deceased' },
  { value: 'sold', label: 'Sold Property' },
  { value: 'other', label: 'Other' },
];

export function Suppression() {
  const [page, setPage] = useState(1);
  const [showAddForm, setShowAddForm] = useState(false);
  const [formData, setFormData] = useState({
    ownerId: '',
    propertyId: '',
    reason: 'do_not_mail',
  });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const { data, isLoading } = useSuppression({ page, limit: 100 });
  const addSuppression = useAddSuppression();

  // For form lookups
  const [ownerSearch, setOwnerSearch] = useState('');
  const [propertySearch, setPropertySearch] = useState('');
  const { data: ownersData } = useOwners({
    page: 1,
    limit: 10,
    name: ownerSearch || undefined,
  });
  const { data: propertiesData } = useProperties({
    page: 1,
    limit: 10,
    apn: propertySearch || undefined,
  });

  const suppressions = data?.data || [];
  const pagination = data?.pagination;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!formData.ownerId || !formData.propertyId) {
      setError('Owner and Property are required');
      return;
    }

    try {
      await addSuppression.mutateAsync({
        ownerId: parseInt(formData.ownerId),
        propertyId: parseInt(formData.propertyId),
        reason: formData.reason,
      });
      setSuccess('Suppression record added successfully');
      setFormData({ ownerId: '', propertyId: '', reason: 'do_not_mail' });
      setShowAddForm(false);
    } catch (err: any) {
      setError(err.message || 'Failed to add suppression');
    }
  };

  const columns: ColumnDef<SuppressionRecord>[] = [
    {
      id: 'id',
      header: 'ID',
      accessorKey: 'id',
      filterType: 'number',
      headerClassName: 'w-16',
    },
    {
      id: 'owner',
      header: 'Owner',
      accessorFn: (row) => row.owner?.ownerName || '',
      filterType: 'text',
      cell: (row) =>
        row.owner ? (
          <Link href={`/owners/${row.owner.id}`}>
            <span className="font-medium text-blue-600 hover:underline">
              {row.owner.ownerName}
            </span>
          </Link>
        ) : (
          '-'
        ),
    },
    {
      id: 'property',
      header: 'Property (APN)',
      accessorFn: (row) => row.property?.apn || '',
      filterType: 'text',
      cell: (row) =>
        row.property ? (
          <Link href={`/properties/${row.property.id}`}>
            <span className="font-medium text-blue-600 hover:underline">
              {row.property.apn}
            </span>
          </Link>
        ) : (
          '-'
        ),
    },
    {
      id: 'state',
      header: 'State',
      accessorFn: (row) => row.property?.state || '',
      filterType: 'text',
      cell: (row) =>
        row.property?.state ? (
          <Badge variant="secondary">{row.property.state}</Badge>
        ) : (
          '-'
        ),
    },
    {
      id: 'reason',
      header: 'Reason',
      accessorKey: 'reason',
      filterType: 'select',
      filterOptions: REASON_OPTIONS,
      cell: (row) => (
        <Badge
          variant={
            row.reason === 'do_not_mail'
              ? 'error'
              : row.reason === 'bad_address'
              ? 'warning'
              : 'secondary'
          }
          className="capitalize"
        >
          {row.reason.replace(/_/g, ' ')}
        </Badge>
      ),
    },
    {
      id: 'createdAt',
      header: 'Created Date',
      accessorKey: 'createdAt',
      filterType: 'date',
      cell: (row) => formatDate(row.createdAt),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Suppression</h2>
          <p className="text-gray-600 mt-1">Manage do-not-mail, deceased, and suppressed records</p>
        </div>
        <button
          onClick={() => {
            setShowAddForm(!showAddForm);
            setError('');
            setSuccess('');
          }}
          className="btn-primary flex items-center gap-2"
        >
          {showAddForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          {showAddForm ? 'Cancel' : 'Add Suppression'}
        </button>
      </div>

      {/* Add Form */}
      {showAddForm && (
        <Card>
          <CardHeader>
            <CardTitle>Add Suppression Record</CardTitle>
          </CardHeader>
          <CardContent>
            {error && (
              <div className="flex items-center gap-2 p-3 bg-red-50 text-red-700 rounded-lg mb-4">
                <AlertCircle className="w-4 h-4" />
                {error}
              </div>
            )}
            {success && (
              <div className="flex items-center gap-2 p-3 bg-green-50 text-green-700 rounded-lg mb-4">
                <CheckCircle className="w-4 h-4" />
                {success}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Owner <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="Search owner name..."
                    value={ownerSearch}
                    onChange={(e) => setOwnerSearch(e.target.value)}
                    className="input-field mb-2"
                  />
                  <select
                    value={formData.ownerId}
                    onChange={(e) => setFormData({ ...formData, ownerId: e.target.value })}
                    className="input-field"
                    required
                  >
                    <option value="">Select an owner</option>
                    {ownersData?.data?.map((owner) => (
                      <option key={owner.id} value={owner.id}>
                        {owner.ownerName} ({owner.id})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Property <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="Search by APN..."
                    value={propertySearch}
                    onChange={(e) => setPropertySearch(e.target.value)}
                    className="input-field mb-2"
                  />
                  <select
                    value={formData.propertyId}
                    onChange={(e) => setFormData({ ...formData, propertyId: e.target.value })}
                    className="input-field"
                    required
                  >
                    <option value="">Select a property</option>
                    {propertiesData?.data?.map((property) => (
                      <option key={property.id} value={property.id}>
                        {property.apn} ({property.state})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Reason</label>
                  <select
                    value={formData.reason}
                    onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                    className="input-field"
                  >
                    {REASON_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={addSuppression.isPending}
                  className="btn-primary flex items-center gap-2"
                >
                  {addSuppression.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                  Add Suppression
                </button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Suppression List */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Ban className="w-5 h-5 text-red-500" />
            Suppressed Records
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
            </div>
          ) : (
            <DataTable
              data={suppressions}
              columns={columns}
              storageKey="suppression_view"
              emptyIcon={<Ban className="w-12 h-12" />}
              emptyText="No suppressed records found"
              emptySubtext="Try adjusting your column filters or search"
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
