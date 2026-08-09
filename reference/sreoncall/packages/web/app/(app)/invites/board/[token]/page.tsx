'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';

export default function BoardInviteAcceptPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const router = useRouter();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [boardId, setBoardId] = useState<string>('');

  useEffect(() => {
    api
      .get<{ board_id: string }>(`/api/v1/invites/board/${token}`)
      .then((member: any) => {
        const id = member?.board_id ?? member?.data?.board_id ?? '';
        setBoardId(String(id));
        setStatus('success');
      })
      .catch((err: unknown) => {
        setErrorMessage(
          err instanceof Error ? err.message : 'Failed to accept board invitation.',
        );
        setStatus('error');
      });
  }, [token]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F8FAFC] dark:bg-navy-base px-4">
      <div className="w-full max-w-md rounded-[14px] bg-white dark:bg-navy-surface p-10 shadow-[0_4px_16px_rgba(0,0,0,0.12)] text-center">
        {status === 'loading' && (
          <>
            <Loader2
              className="mx-auto mb-4 h-12 w-12 animate-spin"
              style={{ color: '#FF6B2B' }}
            />
            <p className="text-[14px] text-[#64748B]">Accepting invitation…</p>
          </>
        )}

        {status === 'success' && (
          <>
            <CheckCircle2 className="mx-auto mb-4 h-12 w-12 text-green-500" />
            <h2 className="mb-2 text-[24px] font-bold text-[#0F172A] dark:text-[#E2E8F0]">
              You've joined the board!
            </h2>
            <p className="mb-6 text-[14px] text-[#64748B]">
              Your invitation has been accepted successfully.
            </p>
            <button
              onClick={() => router.push(boardId ? `/tickets?project_id=${boardId}` : '/projects')}
              className="inline-flex items-center justify-center rounded-[10px] bg-gradient-to-br from-[#FF6B2B] to-[#E85D1C] px-6 text-[15px] font-semibold text-white shadow-[0_2px_8px_rgba(0,0,0,0.08)] transition-all hover:shadow-[0_4px_16px_rgba(255,107,43,0.3)] hover:-translate-y-0.5"
              style={{ height: 48 }}
            >
              Go to Board
            </button>
          </>
        )}

        {status === 'error' && (
          <>
            <XCircle className="mx-auto mb-4 h-12 w-12 text-[#DC2626]" />
            <h2 className="mb-2 text-[24px] font-bold text-[#0F172A] dark:text-[#E2E8F0]">
              Invitation Failed
            </h2>
            <p className="mb-6 text-[14px] text-[#64748B]">{errorMessage}</p>
            <button
              onClick={() => router.push('/projects')}
              className="inline-flex items-center justify-center rounded-[10px] bg-gradient-to-br from-[#FF6B2B] to-[#E85D1C] px-6 text-[15px] font-semibold text-white shadow-[0_2px_8px_rgba(0,0,0,0.08)] transition-all hover:shadow-[0_4px_16px_rgba(255,107,43,0.3)] hover:-translate-y-0.5"
              style={{ height: 48 }}
            >
              Go to Projects
            </button>
          </>
        )}
      </div>
    </div>
  );
}
