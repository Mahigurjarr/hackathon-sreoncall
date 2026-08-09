import Link from 'next/link';

export const metadata = {
  title: 'Terms of Service - SREonCall',
};

export default function TermsOfServicePage() {
  return (
    <div className="w-full max-w-[680px] rounded-[14px] bg-white dark:bg-navy-surface p-8 sm:p-10 shadow-[0_4px_16px_rgba(0,0,0,0.12)] max-h-[80vh] overflow-y-auto">
      <h1 className="text-[22px] font-bold text-[#0F172A] dark:text-[#E2E8F0] mb-1">
        Terms of Service
      </h1>
      <p className="text-[12px] text-[#94A3B8] mb-6">Last updated: March 7, 2026</p>

      <div className="space-y-5 text-[13px] leading-relaxed text-[#334155] dark:text-[#CBD5E1]">
        <section>
          <h2 className="text-[14px] font-semibold text-[#0F172A] dark:text-[#E2E8F0] mb-2">1. Acceptance of Terms</h2>
          <p>
            By creating an account or using the SREonCall platform, you agree to these Terms of
            Service and our <Link href="/privacy" className="text-[#FF6B2B] hover:underline font-medium">Privacy Policy</Link>.
            If you are using SREonCall on behalf of an organization, you represent that you have
            authority to bind that organization.
          </p>
        </section>

        <section>
          <h2 className="text-[14px] font-semibold text-[#0F172A] dark:text-[#E2E8F0] mb-2">2. Service Description</h2>
          <p>
            SREonCall is a multi-tenant SRE operations platform providing incident management,
            on-call scheduling, ticketing, observability, runbook automation, AI agents, and
            status page management.
          </p>
        </section>

        <section>
          <h2 className="text-[14px] font-semibold text-[#0F172A] dark:text-[#E2E8F0] mb-2">3. Accounts &amp; Security</h2>
          <ul className="list-disc pl-5 space-y-1.5">
            <li>You must provide accurate and complete registration information.</li>
            <li>You are responsible for maintaining the security of your account credentials.</li>
            <li>You must enable MFA if required by your organization&apos;s policy.</li>
            <li>Notify us immediately of any unauthorized access to your account.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-[14px] font-semibold text-[#0F172A] dark:text-[#E2E8F0] mb-2">4. Acceptable Use</h2>
          <p className="mb-2">You agree not to:</p>
          <ul className="list-disc pl-5 space-y-1.5">
            <li>Use the platform to store or transmit regulated personal health information (PHI) unless covered by a BAA</li>
            <li>Attempt to access other tenants&apos; data or circumvent multi-tenant isolation</li>
            <li>Exceed published rate limits or API quotas</li>
            <li>Use the AI agent features to automate actions that could cause harm to production systems without appropriate safeguards</li>
          </ul>
        </section>

        <section>
          <h2 className="text-[14px] font-semibold text-[#0F172A] dark:text-[#E2E8F0] mb-2">5. Data Processing</h2>
          <p>
            We process your data as described in our Privacy Policy. For enterprise customers requiring
            a Data Processing Agreement (DPA), contact <strong className="text-[#0F172A] dark:text-white">legal@sreoncall.com</strong>.
          </p>
        </section>

        <section>
          <h2 className="text-[14px] font-semibold text-[#0F172A] dark:text-[#E2E8F0] mb-2">6. Plan Limits &amp; Billing</h2>
          <ul className="list-disc pl-5 space-y-1.5">
            <li>Free tier: limited users, retention, and features as described in plan documentation.</li>
            <li>Paid plans: billed monthly or annually. Charges are non-refundable except as required by law.</li>
            <li>We may modify plan limits with 30 days&apos; notice.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-[14px] font-semibold text-[#0F172A] dark:text-[#E2E8F0] mb-2">7. Service Level</h2>
          <p>
            We target 99.99% platform availability. Specific SLAs are available for Enterprise plan
            customers. Scheduled maintenance windows are communicated in advance.
          </p>
        </section>

        <section>
          <h2 className="text-[14px] font-semibold text-[#0F172A] dark:text-[#E2E8F0] mb-2">8. Data Ownership</h2>
          <p>
            You retain all rights to data you upload to SREonCall. We do not use your data to train
            AI models. Telemetry data sent to the observability stack remains your property.
          </p>
        </section>

        <section>
          <h2 className="text-[14px] font-semibold text-[#0F172A] dark:text-[#E2E8F0] mb-2">9. Termination</h2>
          <ul className="list-disc pl-5 space-y-1.5">
            <li>You may delete your organization at any time. We will purge data per our retention policy.</li>
            <li>We may suspend accounts for Terms violations with notice.</li>
            <li>Upon termination, you may export your data within 30 days.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-[14px] font-semibold text-[#0F172A] dark:text-[#E2E8F0] mb-2">10. Limitation of Liability</h2>
          <p>
            To the maximum extent permitted by law, SREonCall&apos;s liability is limited to the
            amount paid by you in the 12 months preceding the claim.
          </p>
        </section>

        <section>
          <h2 className="text-[14px] font-semibold text-[#0F172A] dark:text-[#E2E8F0] mb-2">11. Governing Law</h2>
          <p>
            These Terms are governed by the laws of India. Disputes shall be resolved through
            arbitration in accordance with the Arbitration and Conciliation Act, 1996.
          </p>
        </section>

        <section>
          <h2 className="text-[14px] font-semibold text-[#0F172A] dark:text-[#E2E8F0] mb-2">12. Changes</h2>
          <p>
            We may update these Terms with 30 days&apos; notice. Continued use after the effective
            date constitutes acceptance.
          </p>
        </section>

        <section>
          <h2 className="text-[14px] font-semibold text-[#0F172A] dark:text-[#E2E8F0] mb-2">13. Contact</h2>
          <p>
            Email: <strong className="text-[#0F172A] dark:text-white">legal@sreoncall.com</strong>
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
