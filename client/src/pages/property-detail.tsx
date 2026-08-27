import { useParams, Link } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card.tsx';
import { Badge } from '../components/ui/Badge.tsx';
import { DataTable, ColumnDef } from '../components/ui/DataTable.tsx';
import { useProperty, Mailing, Deal } from '../hooks/use-api.ts';
import { formatAcreage, formatDate, formatCurrency } from '../lib/format.ts';
import { ArrowLeft, MapPin, Users, Send, TrendingUp, Loader2 } from 'lucide-react';

export function PropertyDetail() {
  const params = useParams<{ id: string }>();
  const id = parseInt(params.id || '0');
  const { data, isLoading, error } = useProperty(id);
  const property = data?.data;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (error || !property) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-bold text-gray-900">Property not found</h2>
        <p className="text-gray-600 mt-2">The property you're looking for doesn't exist.</p>
        <Link href="/properties">
          <button className="btn-primary mt-4">Back to Properties</button>
        </Link>
      </div>
    );
  }

  const owners = property.propertyOwners?.map((po) => po.owner) || [];
  const mailings = property.mailings || [];
  const deals = property.deals || [];

  const mailingColumns: ColumnDef<Mailing>[] = [
    {
      id: 'campaign',
      header: 'Campaign',
      accessorFn: (row) => row.campaign?.name || '',
      filterType: 'text',
      cell: (row) => row.campaign?.name || '-',
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
    {
      id: 'createdAt',
      header: 'Created',
      accessorKey: 'createdAt',
      filterType: 'date',
      cell: (row) => formatDate(row.createdAt),
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
    {
      id: 'createdAt',
      header: 'Created',
      accessorKey: 'createdAt',
      filterType: 'date',
      cell: (row) => formatDate(row.createdAt),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link href="/properties">
        <button className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 transition-colors">
          <ArrowLeft className="w-4 h-4" />
          Back to Properties
        </button>
      </Link>

      {/* Header */}
      <div>
        <div className="flex items-center gap-3">
          <MapPin className="w-6 h-6 text-blue-600" />
          <h2 className="text-2xl font-bold text-gray-900">{property.apn}</h2>
        </div>
        <div className="flex items-center gap-2 mt-2">
          {property.state && <Badge variant="info">{property.state}</Badge>}
          {property.county && <Badge variant="secondary">{property.county}</Badge>}
          {property.zip && <Badge variant="secondary">{property.zip}</Badge>}
        </div>
      </div>

      {/* Property Info */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-gray-600">Acres</p>
            <p className="text-2xl font-bold text-gray-900">{formatAcreage(property.acres)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-gray-600">Latitude</p>
            <p className="text-2xl font-bold text-gray-900">{property.latitude || '-'}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-gray-600">Longitude</p>
            <p className="text-2xl font-bold text-gray-900">{property.longitude || '-'}</p>
          </CardContent>
        </Card>
      </div>

      {/* Legal Description */}
      {property.legalDescription && (
        <Card>
          <CardHeader>
            <CardTitle>Legal Description</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-gray-700">{property.legalDescription}</p>
          </CardContent>
        </Card>
      )}

      {/* Owners */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="w-5 h-5 text-gray-500" />
            Associated Owners ({owners.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {owners.length === 0 ? (
            <p className="text-gray-500 py-4">No owners associated with this property</p>
          ) : (
            <div className="space-y-4">
              {owners.map((owner) => (
                <div key={owner.id} className="flex items-start justify-between p-3 bg-gray-50 rounded-lg">
                  <div>
                    <Link href={`/owners/${owner.id}`}>
                      <span className="font-medium text-blue-600 hover:underline">
                        {owner.ownerName}
                      </span>
                    </Link>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant="secondary">{owner.ownerType}</Badge>
                    </div>
                  </div>
                  <div className="text-right">
                    {owner.mailingAddresses?.map((addr) => (
                      <p key={addr.id} className="text-sm text-gray-500">
                        {addr.addressLine1}
                        {addr.city && `, ${addr.city}`}
                        {addr.state && `, ${addr.state}`}
                      </p>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
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
            storageKey={`property_${property.id}_mailings`}
            emptyIcon={<Send className="w-8 h-8" />}
            emptyText="No mailings for this property"
          />
        </CardContent>
      </Card>

      {/* Deal / Response History */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-gray-500" />
            Deal & Response History ({deals.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <DataTable
            data={deals}
            columns={dealColumns}
            storageKey={`property_${property.id}_deals`}
            emptyIcon={<TrendingUp className="w-8 h-8" />}
            emptyText="No deals for this property"
          />
        </CardContent>
      </Card>
    </div>
  );
}
