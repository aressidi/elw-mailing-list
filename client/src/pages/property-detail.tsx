import { useParams, Link } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card.tsx';
import { Badge } from '../components/ui/Badge.tsx';
import { Table, TableHead, TableBody, TableRow, TableHeader, TableCell } from '../components/ui/Table.tsx';
import { useProperty } from '../hooks/use-api.ts';
import { formatAcreage, formatDate, formatCurrency, formatNumber } from '../lib/format.ts';
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
        <CardContent className="p-0">
          {mailings.length === 0 ? (
            <p className="text-gray-500 py-4 px-6">No mailings for this property</p>
          ) : (
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeader>Campaign</TableHeader>
                  <TableHeader>Mail Date</TableHeader>
                  <TableHeader className="text-right">Offer Price</TableHeader>
                  <TableHeader>Created</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {mailings.map((mailing) => (
                  <TableRow key={mailing.id}>
                    <TableCell>
                      {mailing.campaign?.name || '-'}
                    </TableCell>
                    <TableCell>{formatDate(mailing.mailDate)}</TableCell>
                    <TableCell className="text-right">
                      {mailing.offerPrice ? formatCurrency(Number(mailing.offerPrice)) : '-'}
                    </TableCell>
                    <TableCell>{formatDate(mailing.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
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
        <CardContent className="p-0">
          {deals.length === 0 ? (
            <p className="text-gray-500 py-4 px-6">No deals for this property</p>
          ) : (
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeader>Type</TableHeader>
                  <TableHeader>Date</TableHeader>
                  <TableHeader>Status</TableHeader>
                  <TableHeader>Created</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {deals.map((deal) => (
                  <TableRow key={deal.id}>
                    <TableCell>
                      <Badge variant="secondary">{deal.hitType}</Badge>
                    </TableCell>
                    <TableCell>{formatDate(deal.hitDate)}</TableCell>
                    <TableCell>
                      {deal.isConversion ? (
                        <Badge variant="success">Converted</Badge>
                      ) : deal.isLead ? (
                        <Badge variant="warning">Lead</Badge>
                      ) : (
                        <Badge variant="default">Touch</Badge>
                      )}
                    </TableCell>
                    <TableCell>{formatDate(deal.createdAt)}</TableCell>
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
