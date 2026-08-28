import { useParams, Link } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card.tsx';
import { Badge } from '../components/ui/Badge.tsx';
import { DataTable, ColumnDef } from '../components/ui/DataTable.tsx';
import { useCampaign, Mailing } from '../hooks/use-api.ts';
import { formatDate, formatCurrency, formatNumber } from '../lib/format.ts';
import {
  ArrowLeft,
  Megaphone,
  Send,
  ExternalLink,
  Loader2,
  Users,
  Building,
  MapPin,
  TrendingUp,
  DollarSign,
  Ban,
  Calendar,
} from 'lucide-react';

export function CampaignDetail() {
  const params = useParams<{ id: string }>();
  const id = parseInt(params.id || '0');
  const { data, isLoading, error } = useCampaign(id);
  const campaign = data?.data;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (error || !campaign) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-bold text-gray-900">Campaign not found</h2>
        <p className="text-gray-600 mt-2">The campaign you're looking for doesn't exist.</p>
        <Link href="/campaigns">
          <button className="btn-primary mt-4">Back to Campaigns</button>
        </Link>
      </div>
    );
  }

  const mailings = campaign.mailings || [];
  const stats = campaign.stats;

  const mailingColumns: ColumnDef<Mailing>[] = [
    {
      id: 'owner',
      header: 'Owner',
      accessorFn: (row) => row.owner?.ownerName || '',
      filterType: 'text',
      cell: (row) =>
        row.owner ? (
          <Link href={`/owners/${row.owner.id}`}>
            <span className="text-blue-600 hover:underline font-medium">
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
            <span className="text-blue-600 hover:underline font-mono">
              {row.property.apn}
            </span>
          </Link>
        ) : (
          '-'
        ),
    },
    {
      id: 'address',
      header: 'Address',
      accessorFn: (row) => {
        if (!row.mailingAddress) return '';
        const parts = [
          row.mailingAddress.addressLine1,
          row.mailingAddress.city,
          row.mailingAddress.state,
          row.mailingAddress.zip,
        ].filter(Boolean);
        return parts.join(', ');
      },
      filterType: 'text',
      cell: (row) => {
        if (!row.mailingAddress) return '-';
        return (
          <span className="text-xs text-gray-600">
            {row.mailingAddress.addressLine1}
            {row.mailingAddress.city && <>, {row.mailingAddress.city}</>}
            {row.mailingAddress.state && <>, {row.mailingAddress.state}</>}
            {row.mailingAddress.zip && <> {row.mailingAddress.zip}</>}
          </span>
        );
      },
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

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link href="/campaigns">
        <button className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 transition-colors">
          <ArrowLeft className="w-4 h-4" />
          Back to Campaigns
        </button>
      </Link>

      {/* Header */}
      <div>
        <div className="flex items-center gap-3">
          <Megaphone className="w-6 h-6 text-blue-600" />
          <h2 className="text-2xl font-bold text-gray-900">{campaign.name}</h2>
        </div>
        <div className="flex items-center gap-2 mt-2">
          <Badge variant="secondary">Campaign #{campaign.id}</Badge>
          {campaign.link && (
            <a
              href={campaign.link}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-sm text-blue-600 hover:underline"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Campaign Link
            </a>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="p-2 rounded-lg bg-purple-50">
              <Send className="w-5 h-5 text-purple-600" />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-gray-600 truncate">Mailings Mailed</p>
              <p className="text-xl font-bold text-gray-900">{formatNumber(stats?.mailingsCount || 0)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="p-2 rounded-lg bg-green-50">
              <Users className="w-5 h-5 text-green-600" />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-gray-600 truncate">Owners</p>
              <p className="text-xl font-bold text-gray-900">{formatNumber(stats?.totalOwners || 0)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="p-2 rounded-lg bg-blue-50">
              <Building className="w-5 h-5 text-blue-600" />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-gray-600 truncate">Properties</p>
              <p className="text-xl font-bold text-gray-900">{formatNumber(stats?.totalProperties || 0)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="p-2 rounded-lg bg-emerald-50">
              <DollarSign className="w-5 h-5 text-emerald-600" />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-gray-600 truncate">Total Offer Value</p>
              <p className="text-xl font-bold text-gray-900">{formatCurrency(stats?.totalOfferPrice || 0)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="p-2 rounded-lg bg-orange-50">
              <TrendingUp className="w-5 h-5 text-orange-600" />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-gray-600 truncate">Leads</p>
              <p className="text-xl font-bold text-gray-900">{formatNumber(stats?.leadsCount || 0)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="p-2 rounded-lg bg-indigo-50">
              <TrendingUp className="w-5 h-5 text-indigo-600" />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-gray-600 truncate">Deals</p>
              <p className="text-xl font-bold text-gray-900">{formatNumber(stats?.dealsCount || 0)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="p-2 rounded-lg bg-red-50">
              <Ban className="w-5 h-5 text-red-600" />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-gray-600 truncate">Suppressions</p>
              <p className="text-xl font-bold text-gray-900">{formatNumber(stats?.suppressionsCount || 0)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="p-2 rounded-lg bg-cyan-50">
              <Calendar className="w-5 h-5 text-cyan-600" />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-gray-600 truncate">Created</p>
              <p className="text-xl font-bold text-gray-900">{formatDate(campaign.createdAt)}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* States, Counties & Mail Date Range */}
      <Card>
        <CardContent className="p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <p className="text-sm text-gray-600 flex items-center gap-1.5 mb-2">
              <MapPin className="w-4 h-4 text-gray-400" />
              States
            </p>
            <div className="flex flex-wrap gap-1.5">
              {stats?.states && stats.states.length > 0 ? (
                stats.states.map((st) => (
                  <Badge key={st} variant="secondary" className="font-mono text-xs font-semibold">
                    {st}
                  </Badge>
                ))
              ) : (
                <span className="text-sm text-gray-400">-</span>
              )}
            </div>
          </div>
          <div>
            <p className="text-sm text-gray-600 flex items-center gap-1.5 mb-2">
              <MapPin className="w-4 h-4 text-gray-400" />
              Counties
            </p>
            <p className="text-sm text-gray-800">
              {stats?.counties && stats.counties.length > 0 ? stats.counties.join(', ') : '-'}
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-600 flex items-center gap-1.5 mb-2">
              <Calendar className="w-4 h-4 text-gray-400" />
              Mail Date Range
            </p>
            <p className="text-sm text-gray-800">
              {stats?.firstMailDate ? formatDate(stats.firstMailDate) : '-'}
              {stats?.lastMailDate && stats.lastMailDate !== stats.firstMailDate && (
                <> &ndash; {formatDate(stats.lastMailDate)}</>
              )}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Mailing List */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Send className="w-5 h-5 text-gray-500" />
            Mailing List ({mailings.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <DataTable
            data={mailings}
            columns={mailingColumns}
            storageKey={`campaign_${campaign.id}_mailings`}
            emptyIcon={<Send className="w-8 h-8" />}
            emptyText="No mailings in this campaign"
          />
        </CardContent>
      </Card>
    </div>
  );
}
