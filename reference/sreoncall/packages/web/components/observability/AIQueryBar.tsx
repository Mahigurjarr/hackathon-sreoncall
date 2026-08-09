'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import { Sparkles, ArrowRight, Copy, Check, ExternalLink, Loader2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useAIQuery, AIQueryResult } from '@/lib/hooks/useAIQuery';

function getExplorerPath(type: string): string {
  switch (type) {
    case 'promql':
      return '/observability/metrics';
    case 'logql':
      return '/observability/logs';
    case 'traceql':
      return '/observability/traces';
    default:
      return '/observability/metrics';
  }
}

function QueryBlock({ query }: { query: AIQueryResult['queries'][number] }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(query.query);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [query.query]);

  const explorerPath = `${getExplorerPath(query.type)}?query=${encodeURIComponent(query.query)}`;

  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-3">
      <div className="flex items-center justify-between mb-2">
        <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
          {query.type}
        </Badge>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-zinc-400 hover:text-zinc-200"
            onClick={handleCopy}
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-emerald-400" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </Button>
          <Link href={explorerPath}>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-zinc-400 hover:text-zinc-200"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>
          </Link>
        </div>
      </div>
      <code className="text-sm font-mono text-orange-400 break-all">{query.query}</code>
    </div>
  );
}

export default function AIQueryBar() {
  const [question, setQuestion] = useState('');
  const { mutate, data, error, isPending, reset } = useAIQuery();

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = question.trim();
      if (!trimmed || isPending) return;
      mutate(trimmed);
    },
    [question, isPending, mutate],
  );

  return (
    <div className="space-y-4">
      {/* Input bar */}
      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <div className="relative flex-1">
          <Sparkles className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-orange-400" />
          <input
            type="text"
            value={question}
            onChange={(e) => {
              setQuestion(e.target.value);
              if (error) reset();
            }}
            placeholder="Ask a question... e.g., 'What's the error rate for payment service?'"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 pl-10 pr-4 py-2.5 text-sm text-zinc-200 placeholder:text-zinc-500 outline-none focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/30"
          />
        </div>
        <Button
          type="submit"
          disabled={isPending || !question.trim()}
          className="bg-orange-600 hover:bg-orange-500 text-white shrink-0"
        >
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ArrowRight className="h-4 w-4" />
          )}
        </Button>
      </form>

      {/* Error state */}
      {error && (
        <Card className="border-red-500/30 bg-red-950/20">
          <CardContent className="p-4">
            <p className="text-sm text-red-400">{error.message}</p>
          </CardContent>
        </Card>
      )}

      {/* Results */}
      {data && (
        <Card className="border-zinc-700 bg-zinc-900">
          <CardContent className="p-5 space-y-5">
            {/* Answer */}
            <p className="text-sm text-zinc-200 leading-relaxed whitespace-pre-wrap">
              {data.answer}
            </p>

            {/* Generated queries */}
            {data.queries.length > 0 && (
              <div className="space-y-3">
                <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                  Generated Queries
                </h4>
                {data.queries.map((q, i) => (
                  <QueryBlock key={i} query={q} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
