'use client';

import { useState } from 'react';
import { Loader2, Video, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/Dialog';
import { cn } from '@/lib/utils';
import {
  useStartSession,
  useFinalizeUpload,
  uploadRecording,
  type NotetakerSession,
} from '@/lib/hooks/useNotetaker';
import { useChannels } from '@/lib/hooks/useChannels';
import { useIncidents } from '@/lib/hooks/useIncidents';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channelId?: string;
  incidentId?: string;
  onStarted?: (session: NotetakerSession) => void;
}

type Mode = 'meeting' | 'upload';

export function StartNotetakerDialog({ open, onOpenChange, channelId, incidentId, onStarted }: Props) {
  const [mode, setMode] = useState<Mode>('meeting');
  const [title, setTitle] = useState('');
  const [meetingUrl, setMeetingUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  // Manual linking — only used when the dialog isn't already scoped to a war room.
  const [linkChannelId, setLinkChannelId] = useState('');
  const [linkIncidentId, setLinkIncidentId] = useState('');

  const startSession = useStartSession();
  const finalizeUpload = useFinalizeUpload();

  // Only fetch link options when the dialog isn't already scoped (standalone page).
  const scoped = !!channelId;
  const { data: channels } = useChannels();
  const { data: incidents } = useIncidents();

  const effectiveChannelId = channelId ?? (linkChannelId || undefined);
  const effectiveIncidentId = incidentId ?? (linkIncidentId || undefined);

  function reset() {
    setTitle('');
    setMeetingUrl('');
    setFile(null);
    setMode('meeting');
    setLinkChannelId('');
    setLinkIncidentId('');
  }

  async function handleSubmit() {
    if (!title.trim()) {
      toast.error('Give the session a title.');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'meeting') {
        if (!meetingUrl.trim()) {
          toast.error('Paste the meeting link the bot should join.');
          return;
        }
        const res = await startSession.mutateAsync({
          source: 'recall_bot',
          title: title.trim(),
          meeting_url: meetingUrl.trim(),
          channel_id: effectiveChannelId,
          incident_id: effectiveIncidentId,
        });
        toast.success('Notetaker bot is joining the meeting.');
        onStarted?.(res.session);
      } else {
        if (!file) {
          toast.error('Choose a recording file to upload.');
          return;
        }
        const res = await startSession.mutateAsync({
          source: 'upload',
          title: title.trim(),
          channel_id: effectiveChannelId,
          incident_id: effectiveIncidentId,
          upload: { original_name: file.name, mime_type: file.type || 'application/octet-stream', size_bytes: file.size },
        });
        if (!res.upload) throw new Error('No upload target returned.');
        await uploadRecording(res.upload.file_id, file);
        await finalizeUpload.mutateAsync(res.session.id);
        toast.success('Recording uploaded — transcription started.');
        onStarted?.(res.session);
      }
      reset();
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err?.body?.detail || err?.message || 'Failed to start notetaker.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={() => onOpenChange(false)}>
      <DialogContent>
        <DialogClose onClose={() => onOpenChange(false)} />
        <DialogHeader>
          <DialogTitle>Start AI Notetaker</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 p-6">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setMode('meeting')}
              className={cn(
                'flex items-center gap-2 rounded-[8px] border p-3 text-sm transition',
                mode === 'meeting' ? 'border-[#FF6B2B] bg-[#FFF3ED] text-[#E85D1C]' : 'border-border hover:bg-accent'
              )}
            >
              <Video className="h-4 w-4" /> Join a meeting
            </button>
            <button
              type="button"
              onClick={() => setMode('upload')}
              className={cn(
                'flex items-center gap-2 rounded-[8px] border p-3 text-sm transition',
                mode === 'upload' ? 'border-[#FF6B2B] bg-[#FFF3ED] text-[#E85D1C]' : 'border-border hover:bg-accent'
              )}
            >
              <Upload className="h-4 w-4" /> Upload recording
            </button>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Title</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="INC-0042 bridge call" />
          </div>

          {!scoped && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-sm font-medium">War room / channel <span className="font-normal text-muted-foreground">(optional)</span></label>
                <Select value={linkChannelId} onChange={(e) => setLinkChannelId(e.target.value)}>
                  <option value="">None</option>
                  {(channels || []).map((c) => (
                    <option key={c._id} value={c._id}>
                      {c.type === 'incident_war_room' ? '🚨 ' : ''}{c.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Incident <span className="font-normal text-muted-foreground">(optional)</span></label>
                <Select value={linkIncidentId} onChange={(e) => setLinkIncidentId(e.target.value)}>
                  <option value="">None</option>
                  {(incidents || []).map((i) => (
                    <option key={i.id} value={i.id}>
                      INC-{String(i.number).padStart(4, '0')} · {i.title}
                    </option>
                  ))}
                </Select>
              </div>
              <p className="col-span-2 -mt-1 text-xs text-muted-foreground">
                Link a war room to post the summary there (and relay to its Slack/Teams channel). Link an incident to add timeline notes and tickets to it.
              </p>
            </div>
          )}

          {mode === 'meeting' ? (
            <div>
              <label className="mb-1 block text-sm font-medium">Meeting link</label>
              <Input
                value={meetingUrl}
                onChange={(e) => setMeetingUrl(e.target.value)}
                placeholder="https://zoom.us/j/… · meet.google.com/… · Teams · Slack huddle"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                A notetaker bot joins the call, transcribes it live, and posts a summary here when it ends.
              </p>
            </div>
          ) : (
            <div>
              <label className="mb-1 block text-sm font-medium">Recording file</label>
              <input
                type="file"
                accept="audio/*,video/*"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-[8px] file:border-0 file:bg-[#FFF3ED] file:px-3 file:py-2 file:text-[#E85D1C]"
              />
              {file && <p className="mt-1 text-xs text-muted-foreground">{file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB</p>}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={busy}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {mode === 'meeting' ? 'Send bot' : 'Upload & transcribe'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
