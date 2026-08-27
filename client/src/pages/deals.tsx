import { useState } from 'react';
import { Link } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card.tsx';
import { Badge } from '../components/ui/Badge.tsx';
import { DataTable, ColumnDef } from '../components/ui/DataTable.tsx';
import { useDeals, useDealStats, Deal } from '../hooks/use-api.ts';
import { formatDate, formatPercent } from '../lib/format.ts';
import { TrendingUp, Phone, Mail, Globe, MessageSquare, Send, HelpCircle, Loader2 } from 'lucide-react';

const HIT_TYPE_OPTIONS = [
  { value: 'call', label: 'Call' },
  { value: 'email', label: 'Email' },
  { value: 'website', label: 'Website' },
  { value: 'text', label: 'Text' },
  { value: 'mail', label: 'Mail' },
  { value: 'other', label: 'Other' },
];

const STATUS_OPTIONS = [
  { value: 'converted', label: 'Converted' },
  { value: 'lead', label: 'Lead' },
  { value: 'touch', label: 'Touch' },
];

export function Deals() {
  const { data: dealsData, isLoading } = useDeals({ limit: 100 });
  const { data: statsData } = useDealStats();

  const deals = dealsData?.data || [];
  const stats = statsData?.data;

  const columns: ColumnDef<Deal>[] = [
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
      id: 'county',
      header: 'County',
      accessorFn: (row) => row.property?.county || '',
      filterType: 'text',
      cell: (row) => row.property?.county || '-',
    },
    {
      id: 'hitType',
      header: 'Response Type',
      accessorKey: 'hitType',
      filterType: 'select',
      filterOptions: HIT_TYPE_OPTIONS,
      cell: (row) => {
        const icons: Record<string, any> = {
          call: Phone,
          email: Mail,
          website: Globe,
          text: MessageSquare,
          mail: Send,
          other: HelpCircle,
        };
        const Icon = icons[row.hitType] || HelpCircle;
        return (
          <span className="inline-flex items-center gap-1.5 capitalize text-gray-700">
            <Icon className="w-3.5 h-3.5 text-gray-500" />
            {row.hitType}
          </span>
        );
      },
    },
    {
      id: 'status',
      header: 'Status',
      accessorFn: (row) => (row.isConversion ? 'converted' : row.isLead ? 'lead' : 'touch'),
      filterType: 'select',
      filterOptions: STATUS_OPTIONS,
      cell: (row) => {
        if (row.isConversion) {
          return <Badge variant="success">Converted</Badge>;
        }
        if (row.isLead) {
          return <Badge variant="warning">Lead</Badge>;
        }
        return <Badge variant="secondary">Touch</Badge>;
      },
    },
    {
      id: 'hitDate',
      header: 'Response Date',
      accessorKey: 'hitDate',
      filterType: 'date',
      cell: (row) => formatDate(row.hitDate),
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
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Leads & Deals</h2>
          <p className="text-gray-600 mt-1">Track campaign responses, inbound leads, and conversions</p>
        </div>
        <div className="text-sm text-gray-500">
          {deals.length} total records
        </div>
      </div>

      {/* Summary KPI Cards */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-gray-500 uppercase font-semibold">Total Responses</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{stats.totalDeals}</p>
              <p className="text-xs text-gray-500 mt-0.5">{formatPercent(stats.responseRate)} response rate</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-gray-500 uppercase font-semibold">Leads</p>
              <p className="text-2xl font-bold text-amber-600 mt-1">{stats.totalLeads}</p>
              <p className="text-xs text-gray-500 mt-0.5">{formatPercent(stats.leadRate)} lead rate</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-gray-500 uppercase font-semibold">Conversions</p>
              <p className="text-2xl font-bold text-emerald-600 mt-1">{stats.totalConversions}</p>
              <p className="text-xs text-gray-500 mt-0.5">{formatPercent(stats.conversionRate)} win rate</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-gray-500 uppercase font-semibold">Mailings Sent</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{stats.totalMailings}</p>
              <p className="text-xs text-gray-500 mt-0.5">Total touchpoints</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Table Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-blue-600" />
            All Leads & Deals
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
            </div>
          ) : (
            <DataTable
              data={deals}
              columns={columns}
              storageKey="deals_view"
              emptyIcon={<TrendingUp className="w-12 h-12" />}
              emptyText="No leads or deals found"
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
