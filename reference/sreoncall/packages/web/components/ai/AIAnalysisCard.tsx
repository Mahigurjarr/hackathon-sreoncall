'use client';

import { useState } from 'react';
import { Bot, ChevronDown, ChevronUp, Copy, Check } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { MarkdownRenderer } from './MarkdownRenderer';

interface AIAnalysisCardProps {
  title: string;
  content: string;
  loading?: boolean;
  defaultOpen?: boolean;
  generatedAt?: string;
}

export function AIAnalysisCard({
  title,
  content,
  loading = false,
  defaultOpen = true,
  generatedAt,
}: AIAnalysisCardProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Card className="border-l-4 border-l-[#7C3AED] bg-[#F5F3FF] dark:bg-[#7C3AED]/5">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-4 text-left"
      >
        <div className="flex items-center gap-2">
          <div className="flex-shrink-0 w-7 h-7 rounded-full bg-[#7C3AED]/10 flex items-center justify-center">
            <Bot className="w-4 h-4 text-[#7C3AED]" />
          </div>
          <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</span>
          <Badge variant="ai">AI</Badge>
        </div>
        <div className="flex items-center gap-2">
          {generatedAt && (
            <span className="text-xs text-gray-500">
              {new Date(generatedAt).toLocaleTimeString()}
            </span>
          )}
          {isOpen ? (
            <ChevronUp className="w-4 h-4 text-gray-400" />
          ) : (
            <ChevronDown className="w-4 h-4 text-gray-400" />
          )}
        </div>
      </button>

      {isOpen && (
        <div className="px-4 pb-4">
          {loading ? (
            <div className="flex items-center gap-3 py-6 justify-center">
              <div className="relative">
                <Bot className="w-6 h-6 text-[#7C3AED] animate-pulse" />
                <div className="absolute -bottom-1 -right-1 w-2.5 h-2.5 bg-[#7C3AED] rounded-full animate-ping" />
              </div>
              <span className="text-sm text-[#7C3AED] font-medium">Analyzing...</span>
            </div>
          ) : (
            <>
              <div className="bg-white dark:bg-navy-surface rounded-lg p-4 border border-[#E2E8F0] dark:border-[#1E293B]">
                <MarkdownRenderer content={content} />
              </div>
              <div className="flex justify-end mt-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCopy();
                  }}
                  className="text-xs text-gray-500 hover:text-[#7C3AED]"
                >
                  {copied ? (
                    <>
                      <Check className="w-3.5 h-3.5 mr-1" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 mr-1" />
                      Copy
                    </>
                  )}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </Card>
  );
}
