import { useParams, Link } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card.tsx';
import { Badge } from '../components/ui/Badge.tsx';
import { Table, TableHead, TableBody, TableRow, TableHeader, TableCell } from '../components/ui/Table.tsx';
import { useCampaign } from '../hooks/use-api.ts';
import { formatDate, formatCurrency, formatNumber } from '../lib/format.ts';
import { ArrowLeft, Megaphone, Send, ExternalLink, Loader2 } from 'lucide-react';

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
              <ExternalLink className="w-3 h-3" />
              Campaign Link
            </a>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-gray-600">Total Mailings</p>
            <p className="text-2xl font-bold text-gray-900">{formatNumber(stats?.mailingsCount || 0)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-gray-600">Total Offer Value</p>
            <p className="text-2xl font-bold text-gray-900">
              {formatCurrency(stats?.totalOfferPrice || 0)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-gray-600">Created</p>
            <p className="text-2xl font-bold text-gray-900">{formatDate(campaign.createdAt)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Mailing List */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Send className="w-5 h-5 text-gray-500" />
            Mailing List ({mailings.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {mailings.length === 0 ? (
            <p className="text-gray-500 py-4 px-6">No mailings in this campaign</p>
          ) : (
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeader>Owner</TableHeader>
                  <TableHeader>Property</TableHeader>
                  <TableHeader>Address</TableHeader>
                  <TableHeader>Mail Date</TableHeader>
                  <TableHeader className="text-right">Offer Price</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {mailings.map((mailing) => (
                  <TableRow key={mailing.id}>
                    <TableCell>
                      {mailing.owner ? (
                        <Link href={`/owners/${mailing.owner.id}`}>
                          <span className="text-blue-600 hover:underline">
                            {mailing.owner.ownerName}
                          </span>
                        </Link>
                      ) : (
                        '-'
                      )}
                    </TableCell>
                    <TableCell>
                      {mailing.property ? (
                        <Link href={`/properties/${mailing.property.id}`}>
                          <span className="text-blue-600 hover:underline">
                            {mailing.property.apn}
                          </span>
                        </Link>
                      ) : (
                        '-'
                      )}
                    </TableCell>
                    <TableCell>
                      {mailing.mailingAddress ? (
                        <span className="text-sm">
                          {mailing.mailingAddress.addressLine1}
                          {mailing.mailingAddress.city && (
                            <>, {mailing.mailingAddress.city}</>
                          )}
                          {mailing.mailingAddress.state && (
                            <>, {mailing.mailingAddress.state}</>
                          )}
                        </span>
                      ) : (
                        '-'
                      )}
                    </TableCell>
                    <TableCell>{formatDate(mailing.mailDate)}</TableCell>
                    <TableCell className="text-right">
                      {mailing.offerPrice ? formatCurrency(Number(mailing.offerPrice)) : '-'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
