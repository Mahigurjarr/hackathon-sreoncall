'use client';

import { useState, useEffect } from 'react';
import { Waypoints, Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useTopologySettings, useUpdateTopologySettings } from '@/lib/hooks/useTopologySettings';

interface ToggleRowProps {
  label: string;
  description: string;
  checked: boolean;
  onChange: () => void;
}

function ToggleRow({ label, description, checked, onChange }: ToggleRowProps) {
  return (
    <div className="flex items-center justify-between">
      <div className="space-y-1">
        <label className="text-sm font-medium text-foreground">{label}</label>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={onChange}
        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
          checked ? 'bg-primary' : 'bg-muted'
        }`}
      >
        <span
          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
            checked ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  );
}

export function TopologySettingsCard() {
  const { data, isLoading } = useTopologySettings();
  const updateSettings = useUpdateTopologySettings();

  const [cascadeEnabled, setCascadeEnabled] = useState(false);
  const [autoApprovalEnabled, setAutoApprovalEnabled] = useState(false);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (data && !initialized) {
      setCascadeEnabled(data.data.cascade_enabled);
      setAutoApprovalEnabled(data.data.auto_approval.enabled);
      setInitialized(true);
    }
  }, [data, initialized]);

  async function handleSave() {
    try {
      await updateSettings.mutateAsync({
        cascade_enabled: cascadeEnabled,
        auto_approval: { enabled: autoApprovalEnabled },
      });
      toast.success('Topology settings saved');
    } catch {
      toast.error('Failed to save topology settings');
    }
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex h-32 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Waypoints className="h-5 w-5 text-primary" />
          Topology Automation
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <ToggleRow
          label="Status Cascading"
          description="Automatically propagate a service's status to whatever critically depends on it"
          checked={cascadeEnabled}
          onChange={() => setCascadeEnabled((v) => !v)}
        />
        <ToggleRow
          label="Auto-Approve Discovered Dependencies"
          description="Automatically approve dependency edges once they've been observed enough times to be confident, scaled by criticality"
          checked={autoApprovalEnabled}
          onChange={() => setAutoApprovalEnabled((v) => !v)}
        />
      </CardContent>
      <CardFooter className="justify-end border-t border-border pt-6">
        <Button onClick={handleSave} disabled={updateSettings.isPending}>
          {updateSettings.isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="mr-2 h-4 w-4" />
              Save Settings
            </>
          )}
        </Button>
      </CardFooter>
    </Card>
  );
}
