'use client';

import { useRouter, useParams } from 'next/navigation';
import {
  useProviderSupportContract,
  useAmendSupportContract,
} from '@/lib/hooks/useSupportContracts';
import { Button } from '@/components/ui/Button';
import { ArrowLeft } from 'lucide-react';
import { ContractForm } from '@/components/managed-support/ContractForm';

export default function EditContractPage() {
  const router = useRouter();
  const params = useParams();
  const id = (params?.id as string) || '';
  const { data: contract, isLoading } = useProviderSupportContract(id);
  const amend = useAmendSupportContract();

  if (isLoading || !contract) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button size="icon" variant="ghost" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-xl font-bold">Edit Support Contract</h1>
          <p className="text-sm text-muted-foreground">
            Saving creates a successor contract; the current one is expired automatically.
            {contract.status === 'active' && ' The successor inherits the active status with no coverage gap.'}
          </p>
        </div>
      </div>

      <ContractForm
        mode="edit"
        lockedConsumerId={contract.consumer_tenant_id}
        initial={{
          consumer_tenant_id: contract.consumer_tenant_id,
          name: contract.name,
          coverage_window: contract.coverage_window,
          tiers: contract.tiers,
          sla_targets: contract.sla_targets,
          pricing: contract.pricing,
        }}
        submitLabel="Save changes"
        pending={amend.isPending}
        onSubmit={async (payload) => {
          try {
            const res = await amend.mutateAsync({
              id,
              input: {
                name: payload.name,
                coverage_window: payload.coverage_window,
                tiers: payload.tiers,
                sla_targets: payload.sla_targets,
                pricing: payload.pricing,
              },
            });
            // amendContract returns the successor; route to it.
            router.push(`/managed-support/${res.id}`);
          } catch (err) {
            alert((err as Error).message || 'Failed to update contract');
          }
        }}
        onCancel={() => router.push(`/managed-support/${id}`)}
      />
    </div>
  );
}
