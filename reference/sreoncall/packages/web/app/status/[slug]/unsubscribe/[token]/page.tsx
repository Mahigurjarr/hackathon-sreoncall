import { CheckCircle2, XCircle } from 'lucide-react';
import Link from 'next/link';

async function unsubscribe(slug: string, token: string): Promise<{ ok: boolean; message: string }> {
  try {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
    const res = await fetch(`${apiUrl}/api/v1/public/status-pages/${slug}/unsubscribe/${token}`, {
      cache: 'no-store',
    });
    const data = await res.json();
    return { ok: res.ok, message: data.message || data.detail || 'Unknown error' };
  } catch {
    return { ok: false, message: 'Something went wrong.' };
  }
}

export default async function UnsubscribePage({
  params,
}: {
  params: Promise<{ slug: string; token: string }>;
}) {
  const { slug, token } = await params;
  const result = await unsubscribe(slug, token);

  return (
    <div className="min-h-screen bg-white flex items-center justify-center">
      <div className="max-w-md mx-auto text-center space-y-4 p-8">
        {result.ok ? (
          <>
            <CheckCircle2 className="h-12 w-12 text-emerald-500 mx-auto" />
            <h1 className="text-xl font-bold text-foreground">Unsubscribed</h1>
            <p className="text-sm text-muted-foreground">{result.message}</p>
          </>
        ) : (
          <>
            <XCircle className="h-12 w-12 text-red-500 mx-auto" />
            <h1 className="text-xl font-bold text-foreground">Unsubscribe Failed</h1>
            <p className="text-sm text-muted-foreground">{result.message}</p>
          </>
        )}
        <Link
          href={`/status/${slug}`}
          className="inline-flex items-center justify-center rounded-[8px] bg-[#0F172A] dark:bg-[#E2E8F0] px-4 py-2 text-sm font-medium text-white dark:text-[#0F172A] hover:opacity-90 transition-opacity"
        >
          Back to Status Page
        </Link>
      </div>
    </div>
  );
}
