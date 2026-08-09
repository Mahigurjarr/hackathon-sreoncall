'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Users, Plus, X, Trash2 } from 'lucide-react';
import { PartnerPage, PartnerCard, PartnerSectionHeader } from '@/components/partner/PartnerPage';
import { usePartnerMe } from '@/lib/hooks/usePartnerProfile';

interface Member {
  _id: string;
  name: string;
  email: string;
  role: 'owner' | 'admin' | 'member';
  lastLoginAt: string | null;
  createdAt: string;
}

interface Invite {
  _id: string;
  email: string;
  role: string;
  status: string;
  expiresAt: string;
  createdAt: string;
}

async function pf<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `API error ${res.status}`);
  }
  return res.json();
}

function RoleBadge({ role }: { role: string }) {
  const colors: Record<string, string> = {
    owner: 'bg-[#FF6B2B]/15 text-[#FF6B2B] border-[#FF6B2B]/30',
    admin: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
    member: 'bg-[#F1F5F9] text-[#64748B] border-[#CBD5E1]',
  };
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize ${colors[role] || colors.member}`}>
      {role}
    </span>
  );
}

export default function PartnerTeamPage() {
  const qc = useQueryClient();
  const { data: me } = usePartnerMe();
  const myRole = me?.partnerUser.role ?? 'member';
  const canManage = myRole === 'owner' || myRole === 'admin';
  const isOwner = myRole === 'owner';

  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'member'>('member');
  const [error, setError] = useState<string | null>(null);

  const membersQ = useQuery<{ data: Member[] }>({
    queryKey: ['partner-team-members'],
    queryFn: () => pf('/api/v1/partner/team/members'),
  });

  const invitesQ = useQuery<{ data: Invite[] }>({
    queryKey: ['partner-team-invites'],
    queryFn: () => pf('/api/v1/partner/team/invites'),
    enabled: canManage,
  });

  const inviteMut = useMutation({
    mutationFn: () =>
      pf('/api/v1/partner/team/invites', {
        method: 'POST',
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      }),
    onSuccess: () => {
      setInviteEmail('');
      setInviteRole('member');
      setShowInvite(false);
      setError(null);
      qc.invalidateQueries({ queryKey: ['partner-team-invites'] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const revokeMut = useMutation({
    mutationFn: (id: string) =>
      pf(`/api/v1/partner/team/invites/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['partner-team-invites'] }),
  });

  const removeMut = useMutation({
    mutationFn: (id: string) =>
      pf(`/api/v1/partner/team/members/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['partner-team-members'] }),
  });

  const roleMut = useMutation({
    mutationFn: ({ id, role }: { id: string; role: string }) =>
      pf(`/api/v1/partner/team/members/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['partner-team-members'] }),
  });

  const action = canManage ? (
    <button
      onClick={() => setShowInvite(true)}
      className="inline-flex items-center gap-1.5 rounded-lg bg-[#FF6B2B] px-3.5 py-2 text-sm font-semibold text-white hover:bg-[#E85D1F]"
    >
      <Plus size={15} /> Invite member
    </button>
  ) : null;

  return (
    <PartnerPage
      title="Team"
      subtitle="Invite teammates to collaborate on deals, commissions, and resources"
      icon={Users}
      actions={action}
    >
      <div>
        <PartnerSectionHeader title="Members" description={`${membersQ.data?.data.length ?? 0} total`} />
        <PartnerCard padding="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#E2E8F0] text-[11px] uppercase tracking-wider text-[#94A3B8]">
                  <th className="text-left font-semibold px-5 py-3">Name</th>
                  <th className="text-left font-semibold px-5 py-3">Email</th>
                  <th className="text-left font-semibold px-5 py-3">Role</th>
                  <th className="text-left font-semibold px-5 py-3">Last login</th>
                  <th className="text-right font-semibold px-5 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {membersQ.isLoading ? (
                  <tr><td colSpan={5} className="px-5 py-6 text-center text-[#94A3B8]">Loading…</td></tr>
                ) : membersQ.data?.data.length === 0 ? (
                  <tr><td colSpan={5} className="px-5 py-6 text-center text-[#94A3B8]">No members.</td></tr>
                ) : (
                  membersQ.data?.data.map((m) => (
                    <tr key={m._id} className="border-b border-[#E2E8F0] last:border-0">
                      <td className="px-5 py-3.5 text-[#0F172A]">{m.name}</td>
                      <td className="px-5 py-3.5 text-[#64748B]">{m.email}</td>
                      <td className="px-5 py-3.5">
                        {isOwner && m._id !== me?.partnerUser._id ? (
                          <select
                            value={m.role}
                            onChange={(e) => roleMut.mutate({ id: m._id, role: e.target.value })}
                            className="rounded border border-[#E2E8F0] bg-[#F8FAFC] px-2 py-1 text-xs text-[#0F172A] capitalize"
                          >
                            <option value="owner">owner</option>
                            <option value="admin">admin</option>
                            <option value="member">member</option>
                          </select>
                        ) : (
                          <RoleBadge role={m.role} />
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-[#94A3B8] text-xs">
                        {m.lastLoginAt ? new Date(m.lastLoginAt).toLocaleDateString() : '—'}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        {isOwner && m._id !== me?.partnerUser._id ? (
                          <button
                            onClick={() => {
                              if (confirm(`Remove ${m.name} from the team?`)) removeMut.mutate(m._id);
                            }}
                            className="inline-flex items-center gap-1 text-xs text-[#94A3B8] hover:text-red-400"
                          >
                            <Trash2 size={13} /> Remove
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </PartnerCard>
      </div>

      {canManage ? (
        <div>
          <PartnerSectionHeader
            title="Pending invitations"
            description={`${invitesQ.data?.data.length ?? 0} pending`}
          />
          <PartnerCard padding="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#E2E8F0] text-[11px] uppercase tracking-wider text-[#94A3B8]">
                    <th className="text-left font-semibold px-5 py-3">Email</th>
                    <th className="text-left font-semibold px-5 py-3">Role</th>
                    <th className="text-left font-semibold px-5 py-3">Expires</th>
                    <th className="text-right font-semibold px-5 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {invitesQ.isLoading ? (
                    <tr><td colSpan={4} className="px-5 py-6 text-center text-[#94A3B8]">Loading…</td></tr>
                  ) : invitesQ.data?.data.length === 0 ? (
                    <tr><td colSpan={4} className="px-5 py-6 text-center text-[#94A3B8]">No pending invitations.</td></tr>
                  ) : (
                    invitesQ.data?.data.map((inv) => (
                      <tr key={inv._id} className="border-b border-[#E2E8F0] last:border-0">
                        <td className="px-5 py-3.5 text-[#0F172A]">{inv.email}</td>
                        <td className="px-5 py-3.5"><RoleBadge role={inv.role} /></td>
                        <td className="px-5 py-3.5 text-xs text-[#94A3B8]">
                          {new Date(inv.expiresAt).toLocaleDateString()}
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          <button
                            onClick={() => revokeMut.mutate(inv._id)}
                            className="inline-flex items-center gap-1 text-xs text-[#94A3B8] hover:text-red-400"
                          >
                            <X size={13} /> Revoke
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </PartnerCard>
        </div>
      ) : null}

      {showInvite ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl bg-white border border-[#E2E8F0] p-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-[#0F172A]">Invite a teammate</h3>
              <button onClick={() => { setShowInvite(false); setError(null); }} className="text-[#94A3B8] hover:text-[#0F172A]">
                <X size={18} />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider text-[#94A3B8]">Email</label>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2 text-sm text-[#0F172A] focus:border-[#FF6B2B] outline-none"
                  placeholder="teammate@company.com"
                />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider text-[#94A3B8]">Role</label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as 'admin' | 'member')}
                  className="mt-1 w-full rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2 text-sm text-[#0F172A] focus:border-[#FF6B2B] outline-none"
                >
                  <option value="member">Member — view deals, commissions, resources</option>
                  <option value="admin">Admin — can also invite and manage team</option>
                </select>
              </div>
              {error ? <p className="text-xs text-red-400">{error}</p> : null}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={() => { setShowInvite(false); setError(null); }}
                  className="rounded-lg border border-[#E2E8F0] px-3.5 py-2 text-sm text-[#64748B] hover:bg-[#F1F5F9]"
                >
                  Cancel
                </button>
                <button
                  onClick={() => inviteMut.mutate()}
                  disabled={!inviteEmail || inviteMut.isPending}
                  className="rounded-lg bg-[#FF6B2B] px-3.5 py-2 text-sm font-semibold text-white hover:bg-[#E85D1F] disabled:opacity-50"
                >
                  {inviteMut.isPending ? 'Sending…' : 'Send invite'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </PartnerPage>
  );
}
