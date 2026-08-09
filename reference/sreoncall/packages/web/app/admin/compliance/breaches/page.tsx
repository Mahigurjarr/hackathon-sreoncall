'use client';

import { useState } from 'react';
import { AlertTriangle, Clock, Shield } from 'lucide-react';

export default function BreachTrackerPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <AlertTriangle className="h-6 w-6 text-destructive" />
          Breach Tracker
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Track data breaches and manage GDPR Art 33 / DPDP Sec 8 notifications
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card p-8 text-center">
        <Shield className="h-12 w-12 text-green-500 mx-auto mb-4" />
        <h2 className="text-lg font-semibold text-foreground mb-2">No Breaches Recorded</h2>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          No data security incidents have been logged. When a breach is detected, it will appear
          here with a 72-hour countdown for authority notification (GDPR Art 33).
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card p-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">Breach Response Process</h2>
        <div className="space-y-4">
          <div className="flex gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30 text-red-600 text-sm font-bold">1</div>
            <div>
              <p className="font-medium text-foreground">Detect &amp; Report</p>
              <p className="text-sm text-muted-foreground">Log the breach immediately. 72-hour timer starts.</p>
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-yellow-100 dark:bg-yellow-900/30 text-yellow-600 text-sm font-bold">2</div>
            <div>
              <p className="font-medium text-foreground">Investigate &amp; Contain</p>
              <p className="text-sm text-muted-foreground">Identify scope, affected data categories, and contain the breach.</p>
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 text-sm font-bold">3</div>
            <div>
              <p className="font-medium text-foreground">Notify Affected Users</p>
              <p className="text-sm text-muted-foreground">Send breach notification emails to all affected users.</p>
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30 text-green-600 text-sm font-bold">4</div>
            <div>
              <p className="font-medium text-foreground">Report to Authority</p>
              <p className="text-sm text-muted-foreground">Generate and submit the authority report within 72 hours (GDPR) or as required (DPDP).</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
