import { useParams, Link } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card.tsx';
import { Badge } from '../components/ui/Badge.tsx';
import { Table, TableHead, TableBody, TableRow, TableHeader, TableCell } from '../components/ui/Table.tsx';
import { useOwner } from '../hooks/use-api.ts';
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
          <Badge variant="secondary">{owner.ownerType}</Badge>
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
        <CardContent className="p-0">
          {properties.length === 0 ? (
            <p className="text-gray-500 py-4 px-6">No properties owned</p>
          ) : (
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeader>APN</TableHeader>
                  <TableHeader>State</TableHeader>
                  <TableHeader>County</TableHeader>
                  <TableHeader>ZIP</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {properties.map((property) => (
                  <TableRow key={property.id}>
                    <TableCell>
                      <Link href={`/properties/${property.id}`}>
                        <span className="font-medium text-blue-600 hover:underline">
                          {property.apn}
                        </span>
                      </Link>
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
                  </TableRow>
                ))}
              </TableBody>
            </Table>
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
            <p className="text-gray-500 py-4 px-6">No mailings for this owner</p>
          ) : (
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeader>Campaign</TableHeader>
                  <TableHeader>Property</TableHeader>
                  <TableHeader>Mail Date</TableHeader>
                  <TableHeader className="text-right">Offer Price</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {mailings.map((mailing) => (
                  <TableRow key={mailing.id}>
                    <TableCell>{mailing.campaign?.name || '-'}</TableCell>
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

      {/* Deal History */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-gray-500" />
            Deal History ({deals.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {deals.length === 0 ? (
            <p className="text-gray-500 py-4 px-6">No deals for this owner</p>
          ) : (
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeader>Type</TableHeader>
                  <TableHeader>Property</TableHeader>
                  <TableHeader>Date</TableHeader>
                  <TableHeader>Status</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {deals.map((deal) => (
                  <TableRow key={deal.id}>
                    <TableCell>
                      <Badge variant="secondary">{deal.hitType}</Badge>
                    </TableCell>
                    <TableCell>
                      {deal.property ? (
                        <Link href={`/properties/${deal.property.id}`}>
                          <span className="text-blue-600 hover:underline">
                            {deal.property.apn}
                          </span>
                        </Link>
                      ) : (
                        '-'
                      )}
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
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
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
          <CardContent>
            <div className="space-y-3">
              {suppressions.map((sup) => (
                <div key={sup.id} className="flex items-center justify-between p-3 bg-red-50 rounded-lg">
                  <div>
                    <Badge variant="error">{sup.reason.replace('_', ' ')}</Badge>
                    <p className="text-sm text-gray-600 mt-1">
                      Created: {formatDate(sup.createdAt)}
                    </p>
                  </div>
                  {sup.property && (
                    <Link href={`/properties/${sup.property.id}`}>
                      <span className="text-blue-600 hover:underline text-sm">
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
