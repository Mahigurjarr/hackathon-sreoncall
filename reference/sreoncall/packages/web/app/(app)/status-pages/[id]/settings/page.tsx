'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { Loader2, Save, Search, X, ChevronDown, Lock, BarChart3, Globe, Bell, Check, Palette } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { useStatusPage, useUpdateStatusPage } from '@/lib/hooks/useStatusPages';
import { useServices } from '@/lib/hooks/useServices';
import { useSyntheticChecks } from '@/lib/hooks/useSyntheticChecks';

const languageOptions = [
  { value: 'en', label: 'English (en)' },
  { value: 'es', label: 'Spanish (es)' },
  { value: 'fr', label: 'French (fr)' },
  { value: 'de', label: 'German (de)' },
  { value: 'ja', label: 'Japanese (ja)' },
  { value: 'pt', label: 'Portuguese (pt)' },
  { value: 'zh', label: 'Chinese (zh)' },
];

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-[22px] w-[38px] shrink-0 cursor-pointer rounded-full transition-colors ${
        checked ? 'bg-primary' : 'bg-muted'
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform mt-[3px] ml-[3px] ${
          checked ? 'translate-x-4' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

function ToggleRow({
  checked,
  onChange,
  title,
  description,
  last,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  title: string;
  description: string;
  last?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between py-3 ${!last ? 'border-b border-border' : ''}`}>
      <div>
        <p className="text-[13.5px] font-medium text-foreground">{title}</p>
        <p className="text-[11.5px] text-muted-foreground mt-0.5">{description}</p>
      </div>
      <Toggle checked={checked} onChange={onChange} />
    </div>
  );
}

function AccordionSection({
  icon,
  title,
  open,
  onToggle,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-border rounded-xl overflow-hidden mb-3">
      <button
        onClick={onToggle}
        className="flex items-center justify-between w-full px-4 py-4 bg-card hover:bg-card/80 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-muted-foreground">{icon}</span>
          <span className="text-[13.5px] font-semibold text-foreground">{title}</span>
        </div>
        <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="px-4 pb-4 pt-4 bg-card border-t border-border">
          {children}
        </div>
      )}
    </div>
  );
}

export default function StatusPageSettings() {
  const { id } = useParams();
  const pageId = id as string;
  const { data: page, isLoading } = useStatusPage(pageId);
  const updatePage = useUpdateStatusPage();
  const { data: servicesData } = useServices();
  const allServices = servicesData?.data ?? [];
  const { data: checksData } = useSyntheticChecks();
  const allChecks = checksData?.data ?? [];

  // Accordion state
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    branding: true,
    access: false,
    display: false,
    locale: false,
    announcement: false,
  });

  function toggleSection(key: string) {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  // Access Control
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [showOnLogin, setShowOnLogin] = useState(false);
  const [emailTags, setEmailTags] = useState<string[]>([]);
  const [emailInput, setEmailInput] = useState('');
  const [domainTags, setDomainTags] = useState<string[]>([]);
  const [domainInput, setDomainInput] = useState('');

  // Display Options
  const [showIncidents, setShowIncidents] = useState(true);
  const [showWeeklySummary, setShowWeeklySummary] = useState(false);
  const [showRcaFollowups, setShowRcaFollowups] = useState(false);
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  const [showServicePicker, setShowServicePicker] = useState(false);
  const [serviceSearch, setServiceSearch] = useState('');
  const [selectedCheckIds, setSelectedCheckIds] = useState<string[]>([]);
  const [showCheckPicker, setShowCheckPicker] = useState(false);
  const [checkSearch, setCheckSearch] = useState('');

  // Localization
  const [additionalLocales, setAdditionalLocales] = useState(false);
  const [defaultLanguage, setDefaultLanguage] = useState('en');

  // Branding
  const [primaryColor, setPrimaryColor] = useState('#E8521A');
  const [customDomain, setCustomDomain] = useState('');

  // Custom Announcement
  const [announcementEnabled, setAnnouncementEnabled] = useState(false);
  const [announcementTitle, setAnnouncementTitle] = useState('');
  const [announcementBody, setAnnouncementBody] = useState('');
  const [announcementType, setAnnouncementType] = useState<'info' | 'warning' | 'critical'>('info');

  useEffect(() => {
    if (!page) return;
    const s = page.settings;
    if (s) {
      setVisibility(s.access_control?.visibility || 'public');
      setShowOnLogin(s.show_on_login ?? false);
      setEmailTags(s.access_control?.allowed_viewer_emails || []);
      setDomainTags(s.access_control?.allowed_viewer_domains || []);
      setShowIncidents(s.display_options?.show_incidents ?? true);
      setShowWeeklySummary(s.display_options?.show_weekly_summary ?? false);
      setShowRcaFollowups(s.display_options?.show_rca_followups ?? false);
      setSelectedServiceIds(s.display_options?.selected_service_ids ?? []);
      setSelectedCheckIds(s.display_options?.selected_synthetic_check_ids ?? []);
      setAdditionalLocales(s.localization?.additional_locales_enabled ?? false);
      setDefaultLanguage(s.localization?.default_language || 'en');
      setPrimaryColor(s.branding?.primary_color || '#E8521A');
      setCustomDomain(s.branding?.custom_domain || '');
    }
    const a = page.custom_announcement;
    if (a) {
      setAnnouncementEnabled(a.enabled ?? false);
      setAnnouncementTitle(a.title || '');
      setAnnouncementBody(a.body || '');
      setAnnouncementType(a.type || 'info');
    }
  }, [page]);

  function handleEmailKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const val = emailInput.trim().replace(/,$/,'');
      if (val && !emailTags.includes(val)) {
        setEmailTags([...emailTags, val]);
      }
      setEmailInput('');
    }
  }

  function removeEmailTag(email: string) {
    setEmailTags(emailTags.filter((e) => e !== email));
  }

  const filteredServices = serviceSearch
    ? allServices.filter(
        (s) =>
          s.name.toLowerCase().includes(serviceSearch.toLowerCase()) ||
          (s.type && s.type.toLowerCase().includes(serviceSearch.toLowerCase())),
      )
    : allServices;

  const selectedServices = allServices.filter((s) => selectedServiceIds.includes(s.id));

  function toggleService(id: string) {
    setSelectedServiceIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  const filteredChecks = checkSearch
    ? allChecks.filter(
        (c) =>
          c.name.toLowerCase().includes(checkSearch.toLowerCase()) ||
          c.type.toLowerCase().includes(checkSearch.toLowerCase()),
      )
    : allChecks;

  const selectedChecks = allChecks.filter((c) => selectedCheckIds.includes(c.id));

  function toggleCheck(id: string) {
    setSelectedCheckIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  const checkStatusDot: Record<string, string> = {
    up: 'bg-emerald-400',
    down: 'bg-red-400',
    degraded: 'bg-yellow-400',
  };

  async function handleSave() {
    try {
      await updatePage.mutateAsync({
        id: pageId,
        input: {
          settings: {
            show_on_login: visibility === 'public' ? showOnLogin : false,
            access_control: {
              visibility,
              allowed_viewer_emails: emailTags,
              allowed_viewer_domains: domainTags,
            },
            display_options: {
              show_incidents: showIncidents,
              show_weekly_summary: showWeeklySummary,
              show_rca_followups: showRcaFollowups,
              selected_service_ids: selectedServiceIds,
              selected_synthetic_check_ids: selectedCheckIds,
            },
            localization: {
              additional_locales_enabled: additionalLocales,
              default_language: defaultLanguage,
            },
            branding: {
              primary_color: primaryColor,
              custom_domain: customDomain.trim(),
            },
          },
          custom_announcement: {
            enabled: announcementEnabled,
            title: announcementTitle.trim(),
            body: announcementBody.trim(),
            type: announcementType,
          },
        },
      });
      toast.success('Settings saved');
    } catch (err: any) {
      toast.error(err?.message || 'Failed to save settings');
    }
  }

  if (isLoading) {
    return (
      <div className="flex h-32 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="max-w-[680px]">
      {/* Branding */}
      <AccordionSection
        icon={<Palette className="h-4 w-4" />}
        title="Branding"
        open={openSections.branding}
        onToggle={() => toggleSection('branding')}
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-[10px] font-extrabold uppercase tracking-[1.5px] text-muted-foreground">
              Primary Color
            </label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                className="h-9 w-9 cursor-pointer rounded-lg border-none bg-transparent p-0"
              />
              <span className="text-[13px] font-mono text-muted-foreground">{primaryColor}</span>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-extrabold uppercase tracking-[1.5px] text-muted-foreground">
              Custom Domain
            </label>
            <Input
              placeholder="status.yourcompany.com"
              value={customDomain}
              onChange={(e) => setCustomDomain(e.target.value)}
              className="font-mono text-[12.5px]"
            />
            <p className="text-[11px] text-muted-foreground">
              Requires DNS CNAME to {page?.slug ?? 'your-slug'}.sreoncall.com
            </p>
          </div>
        </div>
      </AccordionSection>

      {/* Access Control */}
      <AccordionSection
        icon={<Lock className="h-4 w-4" />}
        title="Access Control"
        open={openSections.access}
        onToggle={() => toggleSection('access')}
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-[10px] font-extrabold uppercase tracking-[1.5px] text-muted-foreground">Visibility</label>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => setVisibility('public')}
                className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-all ${
                  visibility === 'public'
                    ? 'border-primary/30 bg-primary/5'
                    : 'border-border hover:border-border/80'
                }`}
              >
                <div className={`flex h-4 w-4 items-center justify-center rounded-full border-2 ${
                  visibility === 'public' ? 'border-primary' : 'border-muted-foreground/30'
                }`}>
                  {visibility === 'public' && <div className="h-2 w-2 rounded-full bg-primary" />}
                </div>
                <div>
                  <p className="text-[13.5px] font-medium">Public</p>
                  <p className="text-xs text-muted-foreground">Anyone with the link can view this page</p>
                </div>
              </button>
              <button
                type="button"
                onClick={() => setVisibility('private')}
                className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-all ${
                  visibility === 'private'
                    ? 'border-primary/30 bg-primary/5'
                    : 'border-border hover:border-border/80'
                }`}
              >
                <div className={`flex h-4 w-4 items-center justify-center rounded-full border-2 ${
                  visibility === 'private' ? 'border-primary' : 'border-muted-foreground/30'
                }`}>
                  {visibility === 'private' && <div className="h-2 w-2 rounded-full bg-primary" />}
                </div>
                <div>
                  <p className="text-[13.5px] font-medium">Private</p>
                  <p className="text-xs text-muted-foreground">Only allowed email addresses can view</p>
                </div>
              </button>
            </div>
          </div>

          {visibility === 'public' && (
            <label className="flex items-center gap-3 rounded-lg border border-border p-3 cursor-pointer select-none hover:bg-muted/30 transition-colors">
              <input
                type="checkbox"
                checked={showOnLogin}
                onChange={(e) => setShowOnLogin(e.target.checked)}
                className="h-4 w-4 rounded border-border accent-primary"
              />
              <div>
                <p className="text-[13.5px] font-medium text-foreground">Show on Login Page</p>
                <p className="text-xs text-muted-foreground">Display a &quot;System Status&quot; link on the sign-in page so users can check service health before logging in</p>
              </div>
            </label>
          )}

          {visibility === 'private' && (
            <div className="space-y-2">
              <label className="text-[10px] font-extrabold uppercase tracking-[1.5px] text-muted-foreground">
                Allowed Viewer Emails
              </label>
              <div className="flex flex-wrap gap-1.5 rounded-lg border border-border bg-background p-2 min-h-[42px]">
                {emailTags.map((email) => (
                  <span
                    key={email}
                    className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2.5 py-0.5 text-xs text-foreground"
                  >
                    {email}
                    <button
                      onClick={() => removeEmailTag(email)}
                      className="text-muted-foreground hover:text-destructive transition-colors"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
                <input
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  onKeyDown={handleEmailKeyDown}
                  placeholder="Add email and press Enter..."
                  className="flex-1 min-w-[160px] border-none bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                Individual emails that can access the private status page
              </p>
            </div>
          )}

          {visibility === 'private' && (
            <div className="space-y-2">
              <label className="text-[10px] font-extrabold uppercase tracking-[1.5px] text-muted-foreground">
                Allowed Domains
              </label>
              <div className="flex flex-wrap gap-1.5 rounded-lg border border-border bg-background p-2 min-h-[42px]">
                {domainTags.map((domain) => (
                  <span
                    key={domain}
                    className="inline-flex items-center gap-1.5 rounded-md bg-info/10 px-2.5 py-0.5 text-xs text-info"
                  >
                    @{domain}
                    <button
                      onClick={() => setDomainTags(domainTags.filter((d) => d !== domain))}
                      className="text-info/60 hover:text-destructive transition-colors"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
                <input
                  value={domainInput}
                  onChange={(e) => setDomainInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ',') {
                      e.preventDefault();
                      const val = domainInput.trim().replace(/^@/, '').replace(/,$/,'').toLowerCase();
                      if (val && val.includes('.') && !domainTags.includes(val)) {
                        setDomainTags([...domainTags, val]);
                      }
                      setDomainInput('');
                    }
                  }}
                  placeholder="e.g. thepackengers.com, paylite.me..."
                  className="flex-1 min-w-[160px] border-none bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                Anyone with an email at these domains can access the status page (e.g. thepackengers.com allows all @thepackengers.com emails)
              </p>
            </div>
          )}
        </div>
      </AccordionSection>

      {/* Display Options */}
      <AccordionSection
        icon={<BarChart3 className="h-4 w-4" />}
        title="Display Options"
        open={openSections.display}
        onToggle={() => toggleSection('display')}
      >
        <div>
          <ToggleRow
            checked={showIncidents}
            onChange={setShowIncidents}
            title="Show Incidents"
            description="Display active and historical incidents on the page"
          />
          <ToggleRow
            checked={showWeeklySummary}
            onChange={setShowWeeklySummary}
            title="Show Weekly Summary"
            description="Show uptime summary chart for the past 7 days"
          />
          <ToggleRow
            checked={showRcaFollowups}
            onChange={setShowRcaFollowups}
            title="Show RCA Follow-ups"
            description="Display post-mortem links after resolved incidents"
            last
          />

          {/* Service picker */}
          <div className="mt-4 pt-4 border-t border-border">
            <label className="text-[10px] font-extrabold uppercase tracking-[1.5px] text-muted-foreground">
              Services Displayed on This Page
            </label>

            <div className="flex flex-wrap gap-2 mt-3 mb-3">
              {selectedServices.map((svc) => (
                <span
                  key={svc.id}
                  className="inline-flex items-center gap-1.5 rounded-md bg-primary/10 border border-primary/25 px-3 py-0.5 text-xs font-medium text-primary"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  {svc.name}
                  <button
                    onClick={() => toggleService(svc.id)}
                    className="text-primary/60 hover:text-destructive transition-colors ml-0.5"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
              <button
                onClick={() => setShowServicePicker(!showServicePicker)}
                className="inline-flex items-center gap-1 rounded-md border border-dashed border-border px-3 py-0.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
              >
                + Add / Remove Services
              </button>
            </div>

            {showServicePicker && (
              <div className="rounded-[10px] border border-border overflow-hidden">
                <div className="flex items-center gap-2 border-b border-border p-2">
                  <Search className="h-3.5 w-3.5 text-muted-foreground" />
                  <input
                    type="text"
                    placeholder="Search services..."
                    value={serviceSearch}
                    onChange={(e) => setServiceSearch(e.target.value)}
                    className="flex-1 border-none bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
                  />
                </div>
                <div className="grid grid-cols-2 max-h-[200px] overflow-y-auto divide-x divide-border">
                  {filteredServices.length > 0 ? (
                    filteredServices.map((svc) => {
                      const isSelected = selectedServiceIds.includes(svc.id);
                      return (
                        <button
                          key={svc.id}
                          type="button"
                          onClick={() => toggleService(svc.id)}
                          className={`flex items-center gap-3 p-3 text-left transition-colors border-b border-border ${
                            isSelected ? 'bg-muted/50' : 'hover:bg-muted/30'
                          }`}
                        >
                          <div
                            className={`flex h-4 w-4 items-center justify-center rounded border ${
                              isSelected
                                ? 'bg-primary border-primary text-white'
                                : 'border-border'
                            }`}
                          >
                            {isSelected && <Check className="h-3 w-3" />}
                          </div>
                          <span className="h-2 w-2 rounded-full bg-emerald-400 shrink-0" />
                          <div className="min-w-0">
                            <p className="text-[13px] font-medium text-foreground truncate">{svc.name}</p>
                            {svc.type && (
                              <p className="text-[11px] text-muted-foreground capitalize">{svc.type}</p>
                            )}
                          </div>
                        </button>
                      );
                    })
                  ) : (
                    <div className="col-span-2 p-6 text-center text-[13px] text-muted-foreground">
                      No services match &quot;{serviceSearch}&quot;
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-between border-t border-border px-3 py-1.5">
                  <span className={`text-[11.5px] font-semibold ${selectedServiceIds.length > 0 ? 'text-primary' : 'text-muted-foreground'}`}>
                    {selectedServiceIds.length} service{selectedServiceIds.length !== 1 ? 's' : ''} selected
                  </span>
                  <button
                    onClick={() => setSelectedServiceIds([])}
                    className="text-[11.5px] text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Clear all
                  </button>
                </div>
              </div>
            )}

            <p className="text-[11px] text-muted-foreground mt-2">
              Only selected services appear on the public status page and in notification emails
            </p>
          </div>

          {/* Synthetic Checks picker */}
          <div className="mt-4 pt-4 border-t border-border">
            <label className="text-[10px] font-extrabold uppercase tracking-[1.5px] text-muted-foreground">
              Synthetic Checks Displayed on This Page
            </label>

            <div className="flex flex-wrap gap-2 mt-3 mb-3">
              {selectedChecks.map((chk) => (
                <span
                  key={chk.id}
                  className="inline-flex items-center gap-1.5 rounded-md bg-cyan-500/10 border border-cyan-500/25 px-3 py-0.5 text-xs font-medium text-cyan-500"
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${checkStatusDot[chk.last_status || ''] || 'bg-muted-foreground'}`} />
                  {chk.name}
                  <button
                    onClick={() => toggleCheck(chk.id)}
                    className="text-cyan-500/60 hover:text-destructive transition-colors ml-0.5"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
              <button
                onClick={() => setShowCheckPicker(!showCheckPicker)}
                className="inline-flex items-center gap-1 rounded-md border border-dashed border-border px-3 py-0.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
              >
                + Add / Remove Checks
              </button>
            </div>

            {showCheckPicker && (
              <div className="rounded-[10px] border border-border overflow-hidden">
                <div className="flex items-center gap-2 border-b border-border p-2">
                  <Search className="h-3.5 w-3.5 text-muted-foreground" />
                  <input
                    type="text"
                    placeholder="Search synthetic checks..."
                    value={checkSearch}
                    onChange={(e) => setCheckSearch(e.target.value)}
                    className="flex-1 border-none bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
                  />
                </div>
                <div className="grid grid-cols-2 max-h-[200px] overflow-y-auto divide-x divide-border">
                  {filteredChecks.length > 0 ? (
                    filteredChecks.map((chk) => {
                      const isSelected = selectedCheckIds.includes(chk.id);
                      return (
                        <button
                          key={chk.id}
                          type="button"
                          onClick={() => toggleCheck(chk.id)}
                          className={`flex items-center gap-3 p-3 text-left transition-colors border-b border-border ${
                            isSelected ? 'bg-muted/50' : 'hover:bg-muted/30'
                          }`}
                        >
                          <div
                            className={`flex h-4 w-4 items-center justify-center rounded border ${
                              isSelected
                                ? 'bg-cyan-500 border-cyan-500 text-white'
                                : 'border-border'
                            }`}
                          >
                            {isSelected && <Check className="h-3 w-3" />}
                          </div>
                          <span className={`h-2 w-2 rounded-full shrink-0 ${checkStatusDot[chk.last_status || ''] || 'bg-muted-foreground'}`} />
                          <div className="min-w-0">
                            <p className="text-[13px] font-medium text-foreground truncate">{chk.name}</p>
                            <p className="text-[11px] text-muted-foreground uppercase">{chk.type}{chk.url ? ` \u2014 ${chk.url}` : ''}</p>
                          </div>
                        </button>
                      );
                    })
                  ) : (
                    <div className="col-span-2 p-6 text-center text-[13px] text-muted-foreground">
                      {checkSearch ? `No checks match "${checkSearch}"` : 'No synthetic checks found. Create checks in Monitoring first.'}
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-between border-t border-border px-3 py-1.5">
                  <span className={`text-[11.5px] font-semibold ${selectedCheckIds.length > 0 ? 'text-cyan-500' : 'text-muted-foreground'}`}>
                    {selectedCheckIds.length} check{selectedCheckIds.length !== 1 ? 's' : ''} selected
                  </span>
                  <button
                    onClick={() => setSelectedCheckIds([])}
                    className="text-[11.5px] text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Clear all
                  </button>
                </div>
              </div>
            )}

            <p className="text-[11px] text-muted-foreground mt-2">
              Synthetic checks show real-time uptime monitoring data on the status page
            </p>
          </div>
        </div>
      </AccordionSection>

      {/* Localization */}
      <AccordionSection
        icon={<Globe className="h-4 w-4" />}
        title="Localization"
        open={openSections.locale}
        onToggle={() => toggleSection('locale')}
      >
        <div>
          <ToggleRow
            checked={additionalLocales}
            onChange={setAdditionalLocales}
            title="Enable Additional Locales"
            description="Allow visitors to switch between available languages"
            last
          />

          <div className="mt-4">
            <label className="text-[10px] font-extrabold uppercase tracking-[1.5px] text-muted-foreground">
              Default Language
            </label>
            <Select
              value={defaultLanguage}
              onChange={(e) => setDefaultLanguage(e.target.value)}
              className="mt-2 w-60"
            >
              {languageOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </AccordionSection>

      {/* Custom Announcement */}
      <AccordionSection
        icon={<Bell className="h-4 w-4" />}
        title="Announcement Banner"
        open={openSections.announcement}
        onToggle={() => toggleSection('announcement')}
      >
        <div>
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-[13.5px] font-medium text-foreground">Enable Banner</p>
              <p className="text-[11.5px] text-muted-foreground mt-0.5">Pin a custom banner message on your status page</p>
            </div>
            <Toggle checked={announcementEnabled} onChange={setAnnouncementEnabled} />
          </div>

          {announcementEnabled && (
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-[10px] font-extrabold uppercase tracking-[1.5px] text-muted-foreground">
                  Announcement Type
                </label>
                <Select
                  value={announcementType}
                  onChange={(e) => setAnnouncementType(e.target.value as any)}
                >
                  <option value="info">Info &mdash; Blue banner</option>
                  <option value="warning">Warning &mdash; Yellow banner</option>
                  <option value="critical">Critical &mdash; Red banner</option>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-extrabold uppercase tracking-[1.5px] text-muted-foreground">Title</label>
                <Input
                  placeholder="Scheduled maintenance title..."
                  value={announcementTitle}
                  onChange={(e) => setAnnouncementTitle(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-extrabold uppercase tracking-[1.5px] text-muted-foreground">Body</label>
                <textarea
                  className="flex min-h-[80px] w-full rounded-lg border border-border bg-background px-4 py-2 text-[13px] text-foreground focus-visible:outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/12 resize-y leading-relaxed"
                  placeholder="Details about the announcement..."
                  value={announcementBody}
                  onChange={(e) => setAnnouncementBody(e.target.value)}
                />
              </div>
            </div>
          )}
        </div>
      </AccordionSection>

      {/* Save */}
      <div className="flex justify-end mt-4">
        <Button onClick={handleSave} disabled={updatePage.isPending}>
          {updatePage.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-2 h-4 w-4" />
          )}
          Save Settings
        </Button>
      </div>
    </div>
  );
}
