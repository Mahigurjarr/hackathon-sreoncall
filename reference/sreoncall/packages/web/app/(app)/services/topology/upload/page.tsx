'use client';

import { useState, useRef, useCallback } from 'react';
import Link from 'next/link';
import {
  Upload, FileImage, FileText, ArrowLeft, Loader2, CheckCircle2,
  AlertTriangle, X, File,
} from 'lucide-react';
import { toast } from 'sonner';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

interface UploadJobStatus {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  edges_discovered: number;
  error?: string;
  created_at: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ACCEPTED_TYPES = [
  'image/png',
  'image/jpeg',
  'image/svg+xml',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/markdown',
  'text/html',
];

const ACCEPTED_EXTENSIONS = '.png,.jpg,.jpeg,.svg,.pdf,.docx,.md,.html,.htm';

const FILE_TYPE_ICONS: Record<string, typeof FileImage> = {
  'image/png': FileImage,
  'image/jpeg': FileImage,
  'image/svg+xml': FileImage,
  'application/pdf': FileText,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': FileText,
  'text/markdown': FileText,
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function UploadDiagramPage() {
  const [dragOver, setDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [jobId, setJobId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Poll job status after upload
  const { data: jobStatus } = useQuery<UploadJobStatus>({
    queryKey: ['upload-job', jobId],
    queryFn: async () => {
      const res = await fetch(`/api/v1/service-dependencies/discovery/jobs/${jobId}`);
      if (!res.ok) throw new Error('Failed to fetch job status');
      return res.json();
    },
    enabled: !!jobId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === 'completed' || status === 'failed') return false;
      return 2000;
    },
  });

  const handleFile = useCallback((file: File) => {
    if (!ACCEPTED_TYPES.includes(file.type) && !file.name.endsWith('.md') && !file.name.endsWith('.html') && !file.name.endsWith('.htm')) {
      toast.error('Unsupported file type. Please upload PNG, SVG, PDF, JPG, DOCX, MD, or HTML files.');
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      toast.error('File size exceeds 25 MB limit.');
      return;
    }
    setSelectedFile(file);
    setJobId(null);
  }, []);

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }

  async function handleUpload() {
    if (!selectedFile) return;

    setUploading(true);
    setUploadProgress(0);

    try {
      // Simulate progress since fetch doesn't support progress natively
      const progressInterval = setInterval(() => {
        setUploadProgress((p) => Math.min(p + 15, 90));
      }, 200);

      const formData = new FormData();
      formData.append('file', selectedFile);

      const sessionRes = await fetch('/api/auth/session');
      const session = await sessionRes.json();

      const res = await fetch('/api/v1/service-dependencies/discovery/upload', {
        method: 'POST',
        headers: {
          ...(session?.accessToken ? { Authorization: `Bearer ${session.accessToken}` } : {}),
          'X-Tenant-Slug': session?.tenantSlug || 'platform',
        },
        body: formData,
      });

      clearInterval(progressInterval);
      setUploadProgress(100);

      if (!res.ok) {
        const errorBody = await res.json().catch(() => ({}));
        throw new Error(errorBody?.detail || `Upload failed: ${res.status}`);
      }

      const data = await res.json();
      setJobId(data.job_id || data.id);
      toast.success('File uploaded successfully. Processing started.');
    } catch (err: any) {
      toast.error(err?.message ?? 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  function clearSelection() {
    setSelectedFile(null);
    setJobId(null);
    setUploadProgress(0);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  const FileIcon = selectedFile ? (FILE_TYPE_ICONS[selectedFile.type] ?? File) : File;

  return (
    <div className="space-y-6 px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Link href="/services/topology" className="text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <h1 className="text-2xl font-bold text-foreground">Upload Architecture Diagram</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground ml-8">
            Upload architecture diagrams to automatically discover service dependencies
          </p>
        </div>
      </div>

      {/* Upload Zone */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Upload className="h-5 w-5 text-muted-foreground" />
            Upload File
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!selectedFile ? (
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                'flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 cursor-pointer transition-colors',
                dragOver
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-muted-foreground/50 hover:bg-muted/30',
              )}
            >
              <div className="rounded-full bg-muted p-4 mb-4">
                <Upload className="h-8 w-8 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium text-foreground mb-1">
                Drop your file here or click to browse
              </p>
              <p className="text-xs text-muted-foreground">
                Supports PNG, SVG, PDF, JPG, DOCX, Markdown, and HTML -- up to 25 MB
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_EXTENSIONS}
                onChange={handleFileInput}
                className="hidden"
              />
            </div>
          ) : (
            <div className="space-y-4">
              {/* Selected file info */}
              <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-4 py-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="rounded-lg bg-muted p-2">
                    <FileIcon className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{selectedFile.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {(selectedFile.size / 1024).toFixed(1)} KB
                    </p>
                  </div>
                </div>
                <button
                  onClick={clearSelection}
                  className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                  disabled={uploading}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Progress bar */}
              {(uploading || uploadProgress > 0) && (
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{uploading ? 'Uploading...' : 'Complete'}</span>
                    <span>{uploadProgress}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className={cn(
                        'h-full rounded-full transition-all duration-300',
                        uploadProgress === 100
                          ? 'bg-success'
                          : 'bg-gradient-to-r from-[#FF6B2B] to-[#E85D1C]',
                      )}
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Upload button */}
              {!jobId && (
                <div className="flex justify-end">
                  <Button onClick={handleUpload} disabled={uploading}>
                    {uploading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {uploading ? 'Uploading...' : 'Upload & Process'}
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Job Status */}
      {jobId && jobStatus && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              {jobStatus.status === 'completed' ? (
                <CheckCircle2 className="h-5 w-5 text-success" />
              ) : jobStatus.status === 'failed' ? (
                <AlertTriangle className="h-5 w-5 text-error" />
              ) : (
                <Loader2 className="h-5 w-5 animate-spin text-info" />
              )}
              Processing Status
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div>
                <p className="text-xs text-muted-foreground">Job ID</p>
                <p className="text-sm font-mono text-foreground truncate">{jobStatus.id}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Status</p>
                <div className="mt-0.5">
                  {jobStatus.status === 'pending' && <Badge variant="outline">Pending</Badge>}
                  {jobStatus.status === 'processing' && <Badge variant="info">Processing</Badge>}
                  {jobStatus.status === 'completed' && <Badge variant="success">Completed</Badge>}
                  {jobStatus.status === 'failed' && <Badge variant="destructive">Failed</Badge>}
                </div>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Edges Discovered</p>
                <p className="text-sm font-bold text-foreground">{jobStatus.edges_discovered}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Started</p>
                <p className="text-sm text-foreground">
                  {new Date(jobStatus.created_at).toLocaleString()}
                </p>
              </div>
            </div>

            {jobStatus.error && (
              <div className="rounded-lg border border-error/20 bg-error/5 px-4 py-3">
                <p className="text-sm text-error">{jobStatus.error}</p>
              </div>
            )}

            {jobStatus.status === 'completed' && (
              <div className="flex justify-end">
                <Link href="/services/topology">
                  <Button variant="outline">
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Back to Topology
                  </Button>
                </Link>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
