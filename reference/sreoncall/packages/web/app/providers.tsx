'use client';

import { ReactNode, useState } from 'react';
import { SessionProvider } from 'next-auth/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';

interface ProvidersProps {
  children: ReactNode;
}

export default function Providers({ children }: ProvidersProps) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30 * 1000,
            retry: (failureCount, error) => {
              // Don't retry on 401/403
              if (
                error &&
                'status' in error &&
                (error.status === 401 || error.status === 403)
              ) {
                return false;
              }
              return failureCount < 3;
            },
          },
        },
      }),
  );

  return (
    <SessionProvider>
      <QueryClientProvider client={queryClient}>
        {children}
        <Toaster
          position="top-right"
          toastOptions={{
            duration: 4000,
            classNames: {
              toast:
                'bg-card text-card-foreground border border-border shadow-lg',
              title: 'text-sm font-semibold',
              description: 'text-sm text-muted-foreground',
            },
          }}
        />
      </QueryClientProvider>
    </SessionProvider>
  );
}
