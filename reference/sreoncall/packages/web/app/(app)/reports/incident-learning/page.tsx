'use client';

import { useQuery } from '@tanstack/react-query';
import {
  BookOpen,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Loader2,
  BarChart3,
  RefreshCw,
  FileText,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { MetricCard } from '@/components/dashboard/MetricCard';
import { EmptyState } from '@/components/shared/EmptyState';
import { api, APIError } from '@/lib/api';
import { cn } from '@/lib/utils';

interface RecurrencePattern {
  service: string;
  count_30d: number;
  pattern_description: string;
  open_action_items: number;
  has_overdue: boolean;
}

interface ActionItem {
  id: string;
  title: string;
  owner: string;
  due_date: string;
  status: 'completed' | 'in_progress' | 'overdue' | 'open';
  effectiveness_score: number | null;
  incident_id: string;
}

interface ActionItemSummary {
  total: number;
  completed: number;
  in_progress: number;
  overdue: number;
  items: ActionItem[];
}

interface PostMortemCompletion {
  total_incidents: number;
  with_post_mortem: number;
  without_post_mortem: number;
  completion_rate: number;
}

function useRecurrencePatterns() {
  return useQuery<RecurrencePattern[], APIError>({
    queryKey: ['incident-learning-recurrence'],
    queryFn: async () => {
      const res = await api.get<{ data: RecurrencePattern[] }>(
        '/api/v1/reports/incident-learning/recurrence-patterns',
      );
      return res.data;
    },
  });
}

function useActionItems() {
  return useQuery<ActionItemSummary, APIError>({
    queryKey: ['incident-learning-actions'],
    queryFn: () =>
      api.get<ActionItemSummary>('/api/v1/reports/incident-learning/action-items'),
  });
}

function usePostMortemCompletion() {
  return useQuery<PostMortemCompletion, APIError>({
    queryKey: ['incident-learning-postmortem'],
    queryFn: () =>
      api.get<PostMortemCompletion>(
        '/api/v1/reports/incident-learning/post-mortem-completion',
      ),
  });
}

function getStatusBadgeVariant(
  status: ActionItem['status'],
): 'success' | 'warning' | 'destructive' | 'info' {
  switch (status) {
    case 'completed':
      return 'success';
    case 'in_progress':
      return 'info';
    case 'overdue':
      return 'destructive';
    default:
      return 'warning';
  }
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function IncidentLearningPage() {
  const { data: patterns, isLoading: patternsLoading } = useRecurrencePatterns();
  const { data: actionSummary, isLoading: actionsLoading } = useActionItems();
  const { data: postMortem, isLoading: pmLoading } = usePostMortemCompletion();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Incident Learning</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Recurrence patterns, action item tracking, and post-mortem completion.
        </p>
      </div>

      {/* Post-Mortem Completion Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-blue-500" />
            Post-Mortem Completion
          </CardTitle>
        </CardHeader>
        <CardContent>
          {pmLoading ? (
            <div className="flex h-20 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          ) : !postMortem ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No post-mortem data available.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div className="text-center">
                <p className="text-xs font-medium uppercase text-muted-foreground">
                  Total Incidents
                </p>
                <p className="mt-1 text-2xl font-bold text-foreground">
                  {postMortem.total_incidents}
                </p>
              </div>
              <div className="text-center">
                <p className="text-xs font-medium uppercase text-muted-foreground">
                  With Post-Mortem
                </p>
                <p className="mt-1 text-2xl font-bold text-emerald-500">
                  {postMortem.with_post_mortem}
                </p>
              </div>
              <div className="text-center">
                <p className="text-xs font-medium uppercase text-muted-foreground">
                  Without Post-Mortem
                </p>
                <p className="mt-1 text-2xl font-bold text-red-500">
                  {postMortem.without_post_mortem}
                </p>
              </div>
              <div className="text-center">
                <p className="text-xs font-medium uppercase text-muted-foreground">
                  Completion Rate
                </p>
                <p
                  className={cn(
                    'mt-1 text-2xl font-bold',
                    postMortem.completion_rate >= 80
                      ? 'text-emerald-500'
                      : postMortem.completion_rate >= 50
                        ? 'text-yellow-500'
                        : 'text-red-500',
                  )}
                >
                  {postMortem.completion_rate.toFixed(0)}%
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recurrence Patterns */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RefreshCw className="h-4 w-4 text-orange-500" />
            Recurrence Patterns
          </CardTitle>
        </CardHeader>
        <CardContent>
          {patternsLoading ? (
            <div className="flex h-20 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          ) : !patterns || patterns.length === 0 ? (
            <EmptyState
              icon={BookOpen}
              title="No recurrence patterns"
              description="Recurring incident patterns will appear here as they are detected."
            />
          ) : (
            <div className="space-y-3">
              {patterns.map((pattern, idx) => (
                <div
                  key={idx}
                  className="rounded-lg border border-input p-4 hover:bg-muted/30 transition-colors"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-foreground">
                          {pattern.service}
                        </p>
                        <Badge variant="warning">{pattern.count_30d}x in 30d</Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {pattern.pattern_description}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-xs text-muted-foreground">Action Items</p>
                      <p
                        className={cn(
                          'text-sm font-bold',
                          pattern.has_overdue
                            ? 'text-red-500'
                            : pattern.open_action_items > 0
                              ? 'text-yellow-500'
                              : 'text-emerald-500',
                        )}
                      >
                        {pattern.open_action_items}
                        {pattern.has_overdue && (
                          <AlertTriangle className="inline ml-1 h-3 w-3" />
                        )}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Action Item Tracker */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            Action Item Tracker
          </CardTitle>
        </CardHeader>
        <CardContent>
          {actionsLoading ? (
            <div className="flex h-20 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          ) : !actionSummary ? (
            <EmptyState
              icon={CheckCircle2}
              title="No action items"
              description="Action items from incident post-mortems will appear here."
            />
          ) : (
            <>
              {/* Summary counts */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-4">
                <div className="rounded-lg border border-input p-3 text-center">
                  <p className="text-xs text-muted-foreground">Total</p>
                  <p className="text-lg font-bold text-foreground">
                    {actionSummary.total}
                  </p>
                </div>
                <div className="rounded-lg border border-input p-3 text-center">
                  <p className="text-xs text-muted-foreground">Completed</p>
                  <p className="text-lg font-bold text-emerald-500">
                    {actionSummary.completed}
                  </p>
                </div>
                <div className="rounded-lg border border-input p-3 text-center">
                  <p className="text-xs text-muted-foreground">In Progress</p>
                  <p className="text-lg font-bold text-blue-500">
                    {actionSummary.in_progress}
                  </p>
                </div>
                <div className="rounded-lg border border-input p-3 text-center">
                  <p className="text-xs text-muted-foreground">Overdue</p>
                  <p className="text-lg font-bold text-red-500">
                    {actionSummary.overdue}
                  </p>
                </div>
              </div>

              {/* Action items list */}
              {actionSummary.items.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No action items to display.
                </p>
              ) : (
                <div className="overflow-hidden rounded-lg border border-input">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                          Action Item
                        </th>
                        <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                          Owner
                        </th>
                        <th className="px-4 py-3 text-center font-medium text-muted-foreground">
                          Due Date
                        </th>
                        <th className="px-4 py-3 text-center font-medium text-muted-foreground">
                          Status
                        </th>
                        <th className="px-4 py-3 text-center font-medium text-muted-foreground">
                          Effectiveness
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-input">
                      {actionSummary.items.map((item) => (
                        <tr
                          key={item.id}
                          className="bg-background hover:bg-muted/30"
                        >
                          <td className="px-4 py-3 text-foreground font-medium max-w-[250px] truncate">
                            {item.title}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {item.owner}
                          </td>
                          <td className="px-4 py-3 text-center text-muted-foreground">
                            {formatDate(item.due_date)}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <Badge variant={getStatusBadgeVariant(item.status)}>
                              {item.status.replace('_', ' ')}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-center">
                            {item.effectiveness_score != null ? (
                              <span
                                className={cn(
                                  'font-mono text-xs font-bold',
                                  item.effectiveness_score >= 80
                                    ? 'text-emerald-500'
                                    : item.effectiveness_score >= 50
                                      ? 'text-yellow-500'
                                      : 'text-red-500',
                                )}
                              >
                                {item.effectiveness_score}%
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground">-</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
