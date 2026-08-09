/**
 * One-time reconciliation: merge duplicate Asset rows created before the
 * identity-map fix landed. A tenant can have two rows representing the
 * same physical thing (e.g. Kapsule + lgtm-k8s-cluster, or scw_instance
 * + lgtm-node) because the pre-fix worker keyed dedup on cloud_id alone.
 *
 * Strategy:
 *   1. Group assets per tenant by (bucket, lowercased name) where bucket
 *      collapses k8s_cluster flavors (kapsule/eks/gke/aks) and VM flavors
 *      (scw_instance/ec2/droplet/virtual_machines/compute_engine) into a
 *      single logical identity.
 *   2. In each group with >1 row, pick the canonical row (cloud SDK
 *      cloud_id — NOT starting with `lgtm-` or `beyla-svc:`).
 *   3. Re-parent every child whose parent_asset_id points at a stale row
 *      to the canonical row.
 *   4. Delete the stale rows.
 *
 * Usage:
 *   npx tsx src/scripts/reconcile-duplicate-assets.ts           # dry-run
 *   npx tsx src/scripts/reconcile-duplicate-assets.ts --apply   # commit
 *   npx tsx src/scripts/reconcile-duplicate-assets.ts --tenant 69b92d4b2dce58d4d4a27358 --apply
 */

import mongoose from 'mongoose';

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/sreoncall?replicaSet=rs0';

const K8S_CLUSTER_RESOURCE_TYPES = ['k8s_cluster', 'kapsule', 'eks', 'gke', 'aks', 'doks'];
const VM_RESOURCE_TYPES = ['vm', 'scw_instance', 'ec2', 'droplet', 'virtual_machines', 'compute_engine'];
const DATABASE_RESOURCE_TYPES = ['database', 'rdb', 'rds', 'cloud_sql', 'sql_server'];
const LB_RESOURCE_TYPES = ['loadbalancer', 'scw_lb', 'alb', 'nlb', 'elb', 'do_lb', 'azure_lb', 'gcp_lb'];
const APP_SERVICE_RESOURCE_TYPES = [
  'application_service',
  'scw_functions', 'scw_containers',
  'lambda',
  'cloud_run',
  'app_service',
  'do_app', 'do_functions',
];

function categoryBucket(category: string, resourceType: string): string {
  if (category === 'kubernetes' && K8S_CLUSTER_RESOURCE_TYPES.includes(resourceType)) return 'k8s_cluster';
  if (category === 'compute' && VM_RESOURCE_TYPES.includes(resourceType)) return 'vm';
  if (category === 'database' && (DATABASE_RESOURCE_TYPES.includes(resourceType) || resourceType.startsWith('do_db_'))) return 'database';
  if (category === 'networking' && LB_RESOURCE_TYPES.includes(resourceType)) return 'loadbalancer';
  if ((category === 'serverless' || category === 'compute' || category === 'app_platform')
      && APP_SERVICE_RESOURCE_TYPES.includes(resourceType)) return 'application_service';
  return `${category}:${resourceType}`;
}

function fingerprint(a: { category: string; resource_type: string; name: string }): string {
  return `${categoryBucket(a.category, a.resource_type)}:${a.name.toLowerCase()}`;
}

function isSynthetic(cloudId: string): boolean {
  return cloudId.startsWith('lgtm-') || cloudId.startsWith('beyla-svc:');
}

async function run() {
  const apply = process.argv.includes('--apply');
  const tenantArg = (() => {
    const i = process.argv.indexOf('--tenant');
    return i >= 0 ? process.argv[i + 1] : null;
  })();

  await mongoose.connect(MONGO_URI);
  console.log(`Connected — mode: ${apply ? 'APPLY' : 'DRY-RUN'}${tenantArg ? ` tenant=${tenantArg}` : ''}`);

  const db = mongoose.connection.db!;
  const assets = db.collection('assets');

  const filter: any = {};
  if (tenantArg) filter.tenant_id = new mongoose.Types.ObjectId(tenantArg);

  const rows = await assets.find(filter).toArray();
  console.log(`Loaded ${rows.length} asset rows`);

  // Group by tenant + fingerprint
  const groups = new Map<string, any[]>();
  for (const a of rows) {
    if (a.is_aggregate) continue;
    const key = `${String(a.tenant_id)}::${fingerprint(a as any)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(a);
  }

  const stats = { groups: 0, duplicates: 0, reparented: 0, deleted: 0, skipped: 0 };

  // Second pass: fold synthetic lgtm-k8s-cluster rows onto the canonical
  // managed cluster when the tenant has exactly one managed cluster
  // (kapsule/eks/gke/aks/doks). Needed because the Alloy `cluster` label
  // often doesn't match the cloud-SDK cluster name (e.g. Alloy emits
  // `k8s-cluster` while the Scaleway Kapsule is named `tpk-prod`), so the
  // name-based fingerprint dedup misses even though they're the same
  // logical cluster.
  const perTenantClusters = new Map<string, { managed: any[]; synthetic: any[] }>();
  for (const a of rows) {
    if (a.is_aggregate) continue;
    if (a.category !== 'kubernetes') continue;
    if (!['k8s_cluster', 'kapsule', 'eks', 'gke', 'aks', 'doks'].includes(a.resource_type)) continue;
    const key = String(a.tenant_id);
    if (!perTenantClusters.has(key)) perTenantClusters.set(key, { managed: [], synthetic: [] });
    const e = perTenantClusters.get(key)!;
    if (isSynthetic(a.cloud_id)) e.synthetic.push(a);
    else e.managed.push(a);
  }

  for (const [tenantKey, { managed, synthetic }] of perTenantClusters) {
    if (managed.length !== 1 || synthetic.length === 0) continue;
    const canonical = managed[0];
    console.log(`  SOLE-CLUSTER tenant=${tenantKey}`);
    console.log(`    canonical: ${canonical.cloud_id}  name=${canonical.name}  _id=${canonical._id}`);
    for (const s of synthetic) {
      console.log(`    stale:     ${s.cloud_id}  name=${s.name}  _id=${s._id}`);
      const childFilter = { tenant_id: s.tenant_id, parent_asset_id: s._id };
      const childCount = await assets.countDocuments(childFilter);
      if (childCount > 0) {
        console.log(`    reparent:  ${childCount} children  parent_asset_id ${s._id} → ${canonical._id}`);
        if (apply) {
          await assets.updateMany(childFilter, { $set: { parent_asset_id: canonical._id } });
        }
        stats.reparented += childCount;
      }
      const cloudChildFilter = { tenant_id: s.tenant_id, parent_cloud_id: s.cloud_id };
      const cloudChildCount = await assets.countDocuments(cloudChildFilter);
      if (cloudChildCount > 0) {
        if (apply) {
          await assets.updateMany(cloudChildFilter, { $set: { parent_cloud_id: canonical.cloud_id } });
        }
        stats.reparented += cloudChildCount;
      }
    }
    if (apply) {
      const ids = synthetic.map((s: any) => s._id);
      const res = await assets.deleteMany({ _id: { $in: ids } });
      stats.deleted += res.deletedCount ?? 0;
    } else {
      stats.deleted += synthetic.length;
    }
    stats.groups++;
    stats.duplicates += synthetic.length;
    // Remove the synthetic rows from subsequent fingerprint-dedup loops
    for (const s of synthetic) {
      const key = `${tenantKey}::${fingerprint(s as any)}`;
      const g = groups.get(key);
      if (g) groups.set(key, g.filter((a: any) => String(a._id) !== String(s._id)));
    }
  }

  for (const [key, group] of groups) {
    if (group.length < 2) continue;
    stats.groups++;

    // Canonical = first non-synthetic cloud_id. If none, skip — can't
    // decide which synthetic row should win without a cloud-SDK anchor.
    const canonical = group.find((a: any) => !isSynthetic(a.cloud_id));
    if (!canonical) {
      stats.skipped++;
      console.log(`  SKIP  ${key} — ${group.length} rows, all synthetic cloud_ids`);
      continue;
    }
    const stale = group.filter((a: any) => String(a._id) !== String(canonical._id));
    stats.duplicates += stale.length;

    console.log(`  MERGE ${key}`);
    console.log(`    canonical: ${canonical.cloud_id} (_id=${canonical._id})`);
    for (const s of stale) {
      console.log(`    stale:     ${s.cloud_id} (_id=${s._id})`);
    }

    // Re-parent children of every stale row onto the canonical row.
    for (const s of stale) {
      const childFilter = { tenant_id: s.tenant_id, parent_asset_id: s._id };
      const childCount = await assets.countDocuments(childFilter);
      if (childCount > 0) {
        console.log(`    reparent:  ${childCount} children  parent_asset_id ${s._id} → ${canonical._id}`);
        if (apply) {
          await assets.updateMany(childFilter, { $set: { parent_asset_id: canonical._id } });
        }
        stats.reparented += childCount;
      }
    }

    // Delete the stale rows.
    if (apply) {
      const ids = stale.map((s: any) => s._id);
      const res = await assets.deleteMany({ _id: { $in: ids } });
      stats.deleted += res.deletedCount ?? 0;
    } else {
      stats.deleted += stale.length;
    }
  }

  console.log('');
  console.log('Summary:');
  console.log(`  groups with duplicates: ${stats.groups}`);
  console.log(`  stale rows:             ${stats.duplicates}`);
  console.log(`  children re-parented:   ${stats.reparented}`);
  console.log(`  rows ${apply ? 'deleted' : 'to delete'}:  ${stats.deleted}`);
  console.log(`  groups skipped:         ${stats.skipped}`);
  if (!apply) {
    console.log('\n(dry-run — re-run with --apply to commit changes)');
  }

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('Reconciliation failed:', err);
  process.exit(1);
});
