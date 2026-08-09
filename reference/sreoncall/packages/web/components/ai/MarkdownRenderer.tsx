'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  return (
    <div className={cn('prose prose-sm dark:prose-invert max-w-none', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className="text-lg font-bold mt-4 mb-2 text-gray-900 dark:text-gray-100">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-base font-bold mt-3 mb-2 text-gray-900 dark:text-gray-100">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-sm font-semibold mt-2 mb-1 text-gray-800 dark:text-gray-200">{children}</h3>
          ),
          p: ({ children }) => (
            <p className="text-sm text-gray-700 dark:text-gray-300 mb-2 leading-relaxed">{children}</p>
          ),
          ul: ({ children }) => (
            <ul className="text-sm text-gray-700 dark:text-gray-300 mb-2 pl-4 list-disc space-y-1">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="text-sm text-gray-700 dark:text-gray-300 mb-2 pl-4 list-decimal space-y-1">{children}</ol>
          ),
          li: ({ children }) => (
            <li className="text-sm leading-relaxed">{children}</li>
          ),
          code: ({ children, className: codeClassName }) => {
            const isInline = !codeClassName;
            if (isInline) {
              return (
                <code className="bg-gray-100 dark:bg-gray-800 text-[#7C3AED] px-1.5 py-0.5 rounded text-xs font-mono">
                  {children}
                </code>
              );
            }
            return (
              <code className={cn('block bg-gray-100 dark:bg-gray-800 p-3 rounded-lg text-xs font-mono overflow-x-auto', codeClassName)}>
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre className="bg-gray-100 dark:bg-gray-800 p-3 rounded-lg text-xs overflow-x-auto mb-2">
              {children}
            </pre>
          ),
          strong: ({ children }) => (
            <strong className="font-semibold text-gray-900 dark:text-gray-100">{children}</strong>
          ),
          em: ({ children }) => (
            <em className="text-gray-500 dark:text-gray-400">{children}</em>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto mb-2">
              <table className="min-w-full text-sm border-collapse">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-1.5 text-left text-xs font-semibold">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-gray-200 dark:border-gray-700 px-3 py-1.5 text-xs">{children}</td>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-4 border-[#7C3AED] pl-3 italic text-gray-600 dark:text-gray-400 my-2">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="border-gray-200 dark:border-gray-700 my-3" />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
