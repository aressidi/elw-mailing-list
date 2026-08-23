import { useState } from 'react';
import { useLocation, Link } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card.tsx';
import { Table, TableHead, TableBody, TableRow, TableHeader, TableCell } from '../components/ui/Table.tsx';
import { Pagination } from '../components/ui/Pagination.tsx';
import { useCampaigns } from '../hooks/use-api.ts';
import { formatDate } from '../lib/format.ts';
import { Megaphone, Loader2, ExternalLink } from 'lucide-react';

export function Campaigns() {
  const [page, setPage] = useState(1);
  const [, navigate] = useLocation();

  const { data, isLoading } = useCampaigns({ page, limit: 20 });
  const campaigns = data?.data || [];
  const pagination = data?.pagination;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Campaigns</h2>
          <p className="text-gray-600 mt-1">All mailing campaigns</p>
        </div>
        <div className="text-sm text-gray-500">
          {pagination && `${pagination.total} total campaigns`}
        </div>
      </div>

      {/* Campaigns Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Megaphone className="w-5 h-5 text-gray-500" />
            All Campaigns
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
            </div>
          ) : !campaigns.length ? (
            <div className="text-center py-12 text-gray-500">
              <Megaphone className="w-12 h-12 mx-auto text-gray-300 mb-3" />
              <p>No campaigns found</p>
            </div>
          ) : (
            <>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableHeader>ID</TableHeader>
                    <TableHeader>Campaign Name</TableHeader>
                    <TableHeader>Link</TableHeader>
                    <TableHeader>Created</TableHeader>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {campaigns.map((campaign) => (
                    <TableRow
                      key={campaign.id}
                      className="cursor-pointer"
                      onClick={() => navigate(`/campaigns/${campaign.id}`)}
                    >
                      <TableCell>{campaign.id}</TableCell>
                      <TableCell>
                        <span className="font-medium text-blue-600 hover:underline">
                          {campaign.name}
                        </span>
                      </TableCell>
                      <TableCell>
                        {campaign.link ? (
                          <a
                            href={campaign.link}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="flex items-center gap-1 text-blue-600 hover:underline"
                          >
                            <ExternalLink className="w-3 h-3" />
                            Link
                          </a>
                        ) : (
                          '-'
                        )}
                      </TableCell>
                      <TableCell>{formatDate(campaign.createdAt)}</TableCell>
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
