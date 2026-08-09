import Link from 'next/link';

export const metadata = {
  title: 'Privacy Policy - SREonCall',
};

export default function PrivacyPolicyPage() {
  return (
    <div className="w-full max-w-[680px] rounded-[14px] bg-white dark:bg-navy-surface p-8 sm:p-10 shadow-[0_4px_16px_rgba(0,0,0,0.12)] max-h-[80vh] overflow-y-auto">
      <h1 className="text-[22px] font-bold text-[#0F172A] dark:text-[#E2E8F0] mb-1">
        Privacy Policy
      </h1>
      <p className="text-[12px] text-[#94A3B8] mb-6">Last updated: March 7, 2026</p>

      <div className="space-y-5 text-[13px] leading-relaxed text-[#334155] dark:text-[#CBD5E1]">
        <section>
          <h2 className="text-[14px] font-semibold text-[#0F172A] dark:text-[#E2E8F0] mb-2">1. Data Controller</h2>
          <p>
            SREonCall (&quot;we&quot;, &quot;us&quot;, &quot;our&quot;) is the data controller for
            personal data processed through the SREonCall platform. For questions regarding your data,
            contact our Data Protection Officer at <strong className="text-[#0F172A] dark:text-white">dpo@sreoncall.com</strong>.
          </p>
        </section>

        <section>
          <h2 className="text-[14px] font-semibold text-[#0F172A] dark:text-[#E2E8F0] mb-2">2. Personal Data We Collect</h2>
          <ul className="list-disc pl-5 space-y-1.5">
            <li><strong className="text-[#0F172A] dark:text-white">Account data:</strong> name, email address, phone number, avatar, timezone</li>
            <li><strong className="text-[#0F172A] dark:text-white">Authentication data:</strong> hashed passwords, MFA secrets (encrypted at rest), session tokens</li>
            <li><strong className="text-[#0F172A] dark:text-white">Usage data:</strong> audit logs, IP addresses (anonymized), user agent strings</li>
            <li><strong className="text-[#0F172A] dark:text-white">Operational data:</strong> incidents, tickets, on-call schedules, runbook executions you create or are assigned to</li>
            <li><strong className="text-[#0F172A] dark:text-white">Communication data:</strong> messages sent through integrated channels (Slack, email)</li>
            <li><strong className="text-[#0F172A] dark:text-white">Telemetry data:</strong> metrics, logs, and traces sent to the observability stack (associated with your organization, not individual users)</li>
          </ul>
        </section>

        <section>
          <h2 className="text-[14px] font-semibold text-[#0F172A] dark:text-[#E2E8F0] mb-2">3. Purposes &amp; Legal Basis</h2>
          <div className="overflow-x-auto rounded-lg border border-[#E2E8F0] dark:border-[#1E293B]">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="bg-[#F8FAFC] dark:bg-white/[0.04]">
                  <th className="text-left px-3 py-2 font-semibold text-[#0F172A] dark:text-[#E2E8F0] border-b border-[#E2E8F0] dark:border-[#1E293B]">Purpose</th>
                  <th className="text-left px-3 py-2 font-semibold text-[#0F172A] dark:text-[#E2E8F0] border-b border-[#E2E8F0] dark:border-[#1E293B]">Legal Basis</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E8F0] dark:divide-[#1E293B]">
                <tr><td className="px-3 py-2">Provide the SREonCall platform</td><td className="px-3 py-2">Contract performance</td></tr>
                <tr><td className="px-3 py-2">Authentication &amp; security</td><td className="px-3 py-2">Legitimate interest</td></tr>
                <tr><td className="px-3 py-2">Audit logging</td><td className="px-3 py-2">Legitimate interest / Legal obligation</td></tr>
                <tr><td className="px-3 py-2">Email notifications</td><td className="px-3 py-2">Contract performance / Consent</td></tr>
                <tr><td className="px-3 py-2">Status page subscriptions</td><td className="px-3 py-2">Consent</td></tr>
                <tr><td className="px-3 py-2">Marketing communications</td><td className="px-3 py-2">Consent</td></tr>
                <tr><td className="px-3 py-2">AI-assisted analysis</td><td className="px-3 py-2">Contract performance</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2 className="text-[14px] font-semibold text-[#0F172A] dark:text-[#E2E8F0] mb-2">4. Sub-Processors</h2>
          <ul className="list-disc pl-5 space-y-1.5">
            <li><strong className="text-[#0F172A] dark:text-white">AWS SES</strong> (Amazon Web Services) &mdash; transactional email delivery</li>
            <li><strong className="text-[#0F172A] dark:text-white">Slack</strong> (Salesforce) &mdash; notification delivery via Slack integration</li>
            <li><strong className="text-[#0F172A] dark:text-white">Anthropic Claude</strong> &mdash; AI agent processing (data processed per query, not stored by Anthropic)</li>
            <li><strong className="text-[#0F172A] dark:text-white">Meilisearch</strong> &mdash; self-hosted search engine (no external data transfer)</li>
            <li><strong className="text-[#0F172A] dark:text-white">MinIO</strong> &mdash; self-hosted object storage (no external data transfer)</li>
          </ul>
        </section>

        <section>
          <h2 className="text-[14px] font-semibold text-[#0F172A] dark:text-[#E2E8F0] mb-2">5. Data Retention</h2>
          <ul className="list-disc pl-5 space-y-1.5">
            <li>Account data: retained while account is active; anonymized upon erasure request</li>
            <li>Audit logs: retained per tenant plan (default 90 days), automatically purged via TTL</li>
            <li>Webhook deliveries: 30 days</li>
            <li>Synthetic check results: 30 days</li>
            <li>AI agent executions: 90 days</li>
            <li>Observability data (metrics, logs, traces): 7 days (free tier)</li>
          </ul>
        </section>

        <section>
          <h2 className="text-[14px] font-semibold text-[#0F172A] dark:text-[#E2E8F0] mb-2">6. Your Rights</h2>
          <p className="mb-2">Under GDPR (EU) and DPDP Act 2023 (India), you have the right to:</p>
          <ul className="list-disc pl-5 space-y-1.5">
            <li><strong className="text-[#0F172A] dark:text-white">Access</strong> your personal data (data export)</li>
            <li><strong className="text-[#0F172A] dark:text-white">Rectification</strong> of inaccurate data</li>
            <li><strong className="text-[#0F172A] dark:text-white">Erasure</strong> (&quot;right to be forgotten&quot;)</li>
            <li><strong className="text-[#0F172A] dark:text-white">Data portability</strong> (export in machine-readable format)</li>
            <li><strong className="text-[#0F172A] dark:text-white">Withdraw consent</strong> at any time</li>
            <li><strong className="text-[#0F172A] dark:text-white">Nominate</strong> a representative (DPDP Section 12)</li>
          </ul>
          <p className="mt-2">
            Exercise these rights from <strong className="text-[#0F172A] dark:text-white">Settings &gt; Privacy &amp; Data</strong> in the app,
            or email <strong className="text-[#0F172A] dark:text-white">dpo@sreoncall.com</strong>.
          </p>
        </section>

        <section>
          <h2 className="text-[14px] font-semibold text-[#0F172A] dark:text-[#E2E8F0] mb-2">7. Cross-Border Transfers</h2>
          <p>
            The SREonCall platform is self-hosted on infrastructure located in India. Email delivery
            via AWS SES may involve transfer to AWS regions outside India. Such transfers are governed
            by AWS&apos;s data processing addendum and standard contractual clauses.
          </p>
        </section>

        <section>
          <h2 className="text-[14px] font-semibold text-[#0F172A] dark:text-[#E2E8F0] mb-2">8. Security Measures</h2>
          <ul className="list-disc pl-5 space-y-1.5">
            <li>Passwords hashed with bcrypt (12 rounds)</li>
            <li>MFA secrets encrypted at rest (AES-256-GCM)</li>
            <li>Multi-tenant isolation at database query level</li>
            <li>Role-based access control (RBAC)</li>
            <li>Session management with automatic expiry</li>
            <li>IP addresses anonymized in audit logs</li>
          </ul>
        </section>

        <section>
          <h2 className="text-[14px] font-semibold text-[#0F172A] dark:text-[#E2E8F0] mb-2">9. Cookies</h2>
          <p>
            SREonCall uses only essential cookies required for authentication and session management.
            We do not use analytics, tracking, or advertising cookies.
          </p>
        </section>

        <section>
          <h2 className="text-[14px] font-semibold text-[#0F172A] dark:text-[#E2E8F0] mb-2">10. Contact &amp; Grievance Officer</h2>
          <p>
            Data Protection Officer / Grievance Officer (DPDP Act):<br />
            Email: <strong className="text-[#0F172A] dark:text-white">dpo@sreoncall.com</strong><br />
            Address: SREonCall, India
          </p>
        </section>
      </div>

      <div className="mt-8 pt-5 border-t border-[#E2E8F0] dark:border-[#1E293B]">
        <Link href="/signin" className="text-[13px] font-semibold text-[#FF6B2B] hover:underline">
          &larr; Back to Sign In
        </Link>
      </div>
    </div>
  );
}
