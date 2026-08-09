'use client';

import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { NotetakerSessionView } from '@/components/notetaker/NotetakerSessionView';

export default function NotetakerSessionPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6">
      <Button variant="ghost" size="sm" className="mb-4" onClick={() => router.push('/notetaker')}>
        <ArrowLeft className="h-4 w-4" /> <span className="ml-1">All sessions</span>
      </Button>
      <NotetakerSessionView sessionId={id} />
    </div>
  );
}
