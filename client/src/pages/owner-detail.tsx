import { useParams, Link } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card.tsx';
import { Badge } from '../components/ui/Badge.tsx';
import { DataTable, ColumnDef } from '../components/ui/DataTable.tsx';
import { useOwner, Mailing, Deal, Property } from '../hooks/use-api.ts';
import { formatDate, formatCurrency } from '../lib/format.ts';
import { ArrowLeft, Users, MapPin, Send, TrendingUp, Ban, Loader2, Mail } from 'lucide-react';

export function OwnerDetail() {
  const params = useParams<{ id: string }>();
  const id = parseInt(params.id || '0');
  const { data, isLoading, error } = useOwner(id);
  const owner = data?.data;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (error || !owner) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-bold text-gray-900">Owner not found</h2>
        <p className="text-gray-600 mt-2">The owner you're looking for doesn't exist.</p>
        <Link href="/owners">
          <button className="btn-primary mt-4">Back to Owners</button>
        </Link>
      </div>
    );
  }

  const properties = owner.propertyOwners?.map((po) => po.property) || [];
  const mailingAddresses = owner.mailingAddresses || [];
  const mailings = owner.mailings || [];
  const deals = owner.deals || [];
  const suppressions = owner.suppressions || [];

  const propertyColumns: ColumnDef<Property>[] = [
    {
      id: 'apn',
      header: 'APN',
      accessorKey: 'apn',
      filterType: 'text',
      cell: (row) => (
        <Link href={`/properties/${row.id}`}>
          <span className="font-medium text-blue-600 hover:underline">
            {row.apn}
          </span>
        </Link>
      ),
    },
    {
      id: 'state',
      header: 'State',
      accessorKey: 'state',
      filterType: 'text',
      cell: (row) => (row.state ? <Badge variant="secondary">{row.state}</Badge> : '-'),
    },
    {
      id: 'county',
      header: 'County',
      accessorKey: 'county',
      filterType: 'text',
      cell: (row) => row.county || '-',
    },
    {
      id: 'zip',
      header: 'ZIP',
      accessorKey: 'zip',
      filterType: 'text',
      cell: (row) => row.zip || '-',
    },
  ];

  const mailingColumns: ColumnDef<Mailing>[] = [
    {
      id: 'campaign',
      header: 'Campaign',
      accessorFn: (row) => row.campaign?.name || '',
      filterType: 'text',
      cell: (row) => row.campaign?.name || '-',
    },
    {
      id: 'property',
      header: 'Property (APN)',
      accessorFn: (row) => row.property?.apn || '',
      filterType: 'text',
      cell: (row) =>
        row.property ? (
          <Link href={`/properties/${row.property.id}`}>
            <span className="text-blue-600 hover:underline">
              {row.property.apn}
            </span>
          </Link>
        ) : (
          '-'
        ),
    },
    {
      id: 'mailDate',
      header: 'Mail Date',
      accessorKey: 'mailDate',
      filterType: 'date',
      cell: (row) => formatDate(row.mailDate),
    },
    {
      id: 'offerPrice',
      header: 'Offer Price',
      accessorKey: 'offerPrice',
      filterType: 'number',
      align: 'right',
      cell: (row) => (row.offerPrice ? formatCurrency(Number(row.offerPrice)) : '-'),
      comparator: (a, b) => (Number(a.offerPrice) || 0) - (Number(b.offerPrice) || 0),
    },
  ];

  const dealColumns: ColumnDef<Deal>[] = [
    {
      id: 'hitType',
      header: 'Type',
      accessorKey: 'hitType',
      filterType: 'text',
      cell: (row) => <Badge variant="secondary" className="capitalize">{row.hitType}</Badge>,
    },
    {
      id: 'property',
      header: 'Property (APN)',
      accessorFn: (row) => row.property?.apn || '',
      filterType: 'text',
      cell: (row) =>
        row.property ? (
          <Link href={`/properties/${row.property.id}`}>
            <span className="text-blue-600 hover:underline">
              {row.property.apn}
            </span>
          </Link>
        ) : (
          '-'
        ),
    },
    {
      id: 'hitDate',
      header: 'Date',
      accessorKey: 'hitDate',
      filterType: 'date',
      cell: (row) => formatDate(row.hitDate),
    },
    {
      id: 'status',
      header: 'Status',
      accessorFn: (row) => (row.isConversion ? 'converted' : row.isLead ? 'lead' : 'touch'),
      filterType: 'select',
      filterOptions: [
        { value: 'converted', label: 'Converted' },
        { value: 'lead', label: 'Lead' },
        { value: 'touch', label: 'Touch' },
      ],
      cell: (row) => {
        if (row.isConversion) return <Badge variant="success">Converted</Badge>;
        if (row.isLead) return <Badge variant="warning">Lead</Badge>;
        return <Badge variant="secondary">Touch</Badge>;
      },
    },
  ];

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link href="/owners">
        <button className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 transition-colors">
          <ArrowLeft className="w-4 h-4" />
          Back to Owners
        </button>
      </Link>

      {/* Header */}
      <div>
        <div className="flex items-center gap-3">
          <Users className="w-6 h-6 text-blue-600" />
          <h2 className="text-2xl font-bold text-gray-900">{owner.ownerName}</h2>
        </div>
        <div className="flex items-center gap-2 mt-2">
          <Badge variant="secondary" className="capitalize">{owner.ownerType}</Badge>
          {suppressions.length > 0 && <Badge variant="error">Suppressed</Badge>}
        </div>
      </div>

      {/* Owner Info */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-gray-600">First Name</p>
            <p className="text-lg font-bold text-gray-900">{owner.firstName || '-'}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-gray-600">Last Name</p>
            <p className="text-lg font-bold text-gray-900">{owner.lastName || '-'}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-gray-600">Type</p>
            <p className="text-lg font-bold text-gray-900 capitalize">{owner.ownerType}</p>
          </CardContent>
        </Card>
      </div>

      {/* Mailing Addresses */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="w-5 h-5 text-gray-500" />
            Mailing Addresses ({mailingAddresses.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {mailingAddresses.length === 0 ? (
            <p className="text-gray-500 py-4">No mailing addresses on file</p>
          ) : (
            <div className="space-y-3">
              {mailingAddresses.map((addr) => (
                <div key={addr.id} className="p-3 bg-gray-50 rounded-lg">
                  <p className="font-medium text-gray-900">
                    {addr.addressLine1}
                    {addr.addressLine2 && <span>, {addr.addressLine2}</span>}
                  </p>
                  <p className="text-sm text-gray-500">
                    {addr.city}, {addr.state} {addr.zip}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Owned Properties */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MapPin className="w-5 h-5 text-gray-500" />
            Owned Properties ({properties.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <DataTable
            data={properties}
            columns={propertyColumns}
            storageKey={`owner_${owner.id}_properties`}
            emptyIcon={<MapPin className="w-8 h-8" />}
            emptyText="No properties owned"
          />
        </CardContent>
      </Card>

      {/* Mailing History */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Send className="w-5 h-5 text-gray-500" />
            Mailing History ({mailings.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <DataTable
            data={mailings}
            columns={mailingColumns}
            storageKey={`owner_${owner.id}_mailings`}
            emptyIcon={<Send className="w-8 h-8" />}
            emptyText="No mailings for this owner"
          />
        </CardContent>
      </Card>

      {/* Deal History */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-gray-500" />
            Deal History ({deals.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <DataTable
            data={deals}
            columns={dealColumns}
            storageKey={`owner_${owner.id}_deals`}
            emptyIcon={<TrendingUp className="w-8 h-8" />}
            emptyText="No deals for this owner"
          />
        </CardContent>
      </Card>

      {/* Suppression Records */}
      {suppressions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Ban className="w-5 h-5 text-red-500" />
              Suppression Records ({suppressions.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            <div className="space-y-3">
              {suppressions.map((sup) => (
                <div key={sup.id} className="flex items-center justify-between p-3 bg-red-50 rounded-lg">
                  <div>
                    <Badge variant="error" className="capitalize">{sup.reason.replace('_', ' ')}</Badge>
                    <p className="text-sm text-gray-600 mt-1">
                      Created: {formatDate(sup.createdAt)}
                    </p>
                  </div>
                  {sup.property && (
                    <Link href={`/properties/${sup.property.id}`}>
                      <span className="text-blue-600 hover:underline text-sm font-mono">
                        {sup.property.apn}
                      </span>
                    </Link>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
