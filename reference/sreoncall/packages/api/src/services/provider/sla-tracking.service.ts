import { Types } from 'mongoose';
import { ProviderConsumerLink } from '../../models/provider-consumer-link.model';
import { Incident } from '../../models/incident.model';

export interface SLAMetrics {
  consumer_tenant_id: string;
  consumer_name?: string;
  total_incidents: number;
  avg_response_seconds: number | null;
  avg_resolution_seconds: number | null;
  p50_response_seconds: number | null;
  p90_response_seconds: number | null;
}

export async function getSLAMetrics(
  providerTenantId: Types.ObjectId,
  consumerId?: string,
): Promise<SLAMetrics[]> {
  // Get all linked consumers
  const linkFilter: Record<string, any> = {
    provider_tenant_id: providerTenantId,
    status: 'active',
  };
  if (consumerId) {
    linkFilter.consumer_tenant_id = new Types.ObjectId(consumerId);
  }

  const links = await ProviderConsumerLink.find(linkFilter)
    .populate('consumer_tenant_id', 'slug name');

  const results: SLAMetrics[] = [];

  for (const link of links) {
    const consumerTenantId = link.consumer_tenant_id;
    const cid = (consumerTenantId as any)._id?.toString() || consumerTenantId.toString();

    const incidents = await Incident.find({
      tenant_id: consumerTenantId,
    }).select('metrics createdAt');

    const total = incidents.length;
    const responseTimes: number[] = [];
    const resolutionTimes: number[] = [];

    for (const inc of incidents) {
      if (inc.metrics.mtta_seconds != null) {
        responseTimes.push(inc.metrics.mtta_seconds);
      }
      if (inc.metrics.mttr_seconds != null) {
        resolutionTimes.push(inc.metrics.mttr_seconds);
      }
    }

    responseTimes.sort((a, b) => a - b);
    resolutionTimes.sort((a, b) => a - b);

    const avg = (arr: number[]) => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null;
    const percentile = (arr: number[], p: number) => {
      if (!arr.length) return null;
      const idx = Math.floor(arr.length * p);
      return arr[Math.min(idx, arr.length - 1)];
    };

    results.push({
      consumer_tenant_id: cid,
      consumer_name: (consumerTenantId as any).name || undefined,
      total_incidents: total,
      avg_response_seconds: avg(responseTimes),
      avg_resolution_seconds: avg(resolutionTimes),
      p50_response_seconds: percentile(responseTimes, 0.5),
      p90_response_seconds: percentile(responseTimes, 0.9),
    });
  }

  return results;
}
