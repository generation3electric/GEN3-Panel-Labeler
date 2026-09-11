import React, { useEffect, useMemo, useRef, useState } from 'react';
import ProcessingReview from './ProcessingReview.jsx';
import UploadActivity from './UploadActivity.jsx';
import { PhotoTile, UnavailablePhoto, usePhotoChecks } from './PhotoCapture.jsx';
import { MAX_PHOTOS, PHOTO_RULES_VERSION, photoGuidance, qualityResolved, unavailableReason } from './photoRules.js';
import { getAllLocalPanels, getPendingPanels, markPanelFinalized, markPanelUploaded, panelToFormData, savePendingPanel } from './offlineQueue.js';

const JOB_CACHE_PREFIX = 'gen3-panel-jobs:';

function localDateValue() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

const manufacturers = ['Unknown', 'Square D', 'Eaton / Cutler-Hammer', 'Siemens', 'GE', 'Federal Pacific', 'Zinsco', 'Other'];

function Header({ step, onHome, onUploads, online, pendingCount, syncing }) {
  return (
    <header className="topbar">
      <button className="brand" onClick={onHome} aria-label="Go home">
        <span className="bolt">⚡</span>
        <span><strong>GEN3</strong><small>Panel Labeler</small></span>
      </button>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button type="button" className="stepPill uploadPill" onClick={onUploads} style={{ background: online ? 'rgba(255,255,255,.11)' : '#8b3b19' }}>
          {syncing ? 'Syncing…' : online ? (pendingCount ? `${pendingCount} pending` : 'Online') : 'Offline · saved locally'}
        </button>
        {step > 0 && <div className="stepPill">Step {Math.min(step, 4)} of 4</div>}
      </div>
    </header>
  );
}

function AddPhotoButton({ children, onFiles, multiple = false }) {
  return (
    <label className="primary" style={{ minHeight: 48, display: 'grid', placeItems: 'center', position: 'relative', width: '100%' }}>
      {children}
      <input type="file" accept="image/*" capture="environment" multiple={multiple} onChange={(e) => { onFiles(Array.from(e.target.files || [])); e.target.value = ''; }} style={{ position: 'absolute', opacity: 0, width: 1, height: 1 }} />
    </label>
  );
}

export default function App() {
  const [step, setStep] = useState(0);
  const [job, setJob] = useState(null);
  const [query, setQuery] = useState('');
  const [jobDate, setJobDate] = useState(localDateValue);
  const [jobs, setJobs] = useState([]);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [jobsError, setJobsError] = useState('');
  const [jobsSource, setJobsSource] = useState('');
  const [panel, setPanel] = useState({ name: 'Main Panel', manufacturer: 'Unknown', mainAmps: '', spaces: '', labels: 'Partial' });
  const [overview, setOverview] = useState(null);
  const [leftPhotos, setLeftPhotos] = useState([]);
  const [rightPhotos, setRightPhotos] = useState([]);
  const [directory, setDirectory] = useState(null);
  const [manufacturerPhoto, setManufacturerPhoto] = useState(null);
  const [unavailable, setUnavailable] = useState({ manufacturer: { reason: '', details: '' }, directory: { reason: '', details: '' } });
  const [coverageConfirmed, setCoverageConfirmed] = useState(false);
  const allPhotos = useMemo(() => [overview, ...leftPhotos, ...rightPhotos, manufacturerPhoto, directory].filter(Boolean), [overview, leftPhotos, rightPhotos, manufacturerPhoto, directory]);
  const [photoChecks, updatePhotoCheck] = usePhotoChecks(allPhotos);
  const guidance = photoGuidance(panel.spaces);
  useEffect(() => { setCoverageConfirmed(false); }, [allPhotos, panel.spaces]);
  const photoProps = (file) => ({ quality: photoChecks.get(file), onQuality: (patch) => { updatePhotoCheck(file, patch); setCoverageConfirmed(false); } });
  function clearPhotoDetails() {
    setManufacturerPhoto(null);
    setUnavailable({ manufacturer: { reason: '', details: '' }, directory: { reason: '', details: '' } });
    setCoverageConfirmed(false);
  }
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [savedRecord, setSavedRecord] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);
  const [localPanels, setLocalPanels] = useState([]);
  const [syncing, setSyncing] = useState(false);
  const [localNotice, setLocalNotice] = useState('');
  const [activityOpen, setActivityOpen] = useState(false);
  const syncInFlight = useRef(false);

  const filteredJobs = jobs.filter((j) => `${j.id} ${j.customer} ${j.address} ${j.summary || ''}`.toLowerCase().includes(query.toLowerCase()));
  const capturedCount = allPhotos.length;
  const complete = Boolean(overview && leftPhotos.length && rightPhotos.length &&
    (manufacturerPhoto || unavailableReason(unavailable.manufacturer)) && (directory || unavailableReason(unavailable.directory)) &&
    capturedCount <= MAX_PHOTOS && coverageConfirmed && allPhotos.every((file) => qualityResolved(photoChecks.get(file))));
  const qualityExceptions = allPhotos.filter((file) => photoChecks.get(file)?.accepted).length;

  const processingPhotoUrls = useMemo(() => {
    const result = {};
    if (overview) result.breakerField = URL.createObjectURL(overview);
    leftPhotos.forEach((file, i) => { result[`left-${i + 1}`] = URL.createObjectURL(file); });
    rightPhotos.forEach((file, i) => { result[`right-${i + 1}`] = URL.createObjectURL(file); });
    if (directory) result.directory = URL.createObjectURL(directory);
    if (manufacturerPhoto) result.manufacturer = URL.createObjectURL(manufacturerPhoto);
    return result;
  }, [overview, leftPhotos, rightPhotos, directory, manufacturerPhoto]);
  useEffect(() => () => Object.values(processingPhotoUrls).forEach((url) => URL.revokeObjectURL(url)), [processingPhotoUrls]);

  async function refreshLocalPanels() {
    try {
      const items = await getAllLocalPanels();
      setLocalPanels(items);
      setPendingCount(items.filter((item) => item.status !== 'uploaded' && item.status !== 'finalized').length);
    } catch (error) {
      console.warn('Could not read offline queue', error);
    }
  }

  async function loadJobs(date = jobDate) {
    setJobsLoading(true);
    setJobsError('');
    setJob(null);
    const cacheKey = `${JOB_CACHE_PREFIX}${date}`;
    try {
      const response = await fetch(`/api/servicetitan/jobs?date=${encodeURIComponent(date)}`, { headers: { Accept: 'application/json' } });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'ServiceTitan jobs could not be loaded.');
      setJobs(result.jobs || []);
      setJobsSource('live');
      localStorage.setItem(cacheKey, JSON.stringify({ jobs: result.jobs || [], loadedAt: result.loadedAt }));
    } catch (error) {
      let cached = null;
      try { cached = JSON.parse(localStorage.getItem(cacheKey)); } catch { cached = null; }
      if (cached?.jobs?.length) {
        setJobs(cached.jobs);
        setJobsSource('cached');
        setJobsError(`Live ServiceTitan data is unavailable. Showing the jobs saved on this device from ${new Date(cached.loadedAt).toLocaleString()}.`);
      } else {
        setJobs([]);
        setJobsSource('');
        setJobsError(error.message);
      }
    } finally {
      setJobsLoading(false);
    }
  }

  async function uploadQueuedItem(item) {
    const response = await fetch('/api/sharepoint/panel-records', { method: 'POST', body: panelToFormData(item) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Upload failed.');
    await markPanelUploaded(item.recordId, result);
    return result;
  }

  async function syncPending() {
    if (!navigator.onLine || syncInFlight.current) return;
    syncInFlight.current = true;
    setSyncing(true);
    try {
      const items = await getPendingPanels();
      for (const item of items) {
        try { await uploadQueuedItem(item); }
        catch (error) { console.warn(`Pending panel ${item.recordId} remains local:`, error.message); break; }
      }
    } finally {
      await refreshLocalPanels();
      setSyncing(false);
      syncInFlight.current = false;
    }
  }

  useEffect(() => {
    refreshLocalPanels();
    const onOnline = () => { setOnline(true); window.setTimeout(syncPending, 250); };
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    if (navigator.onLine) window.setTimeout(syncPending, 500);
    return () => { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline); };
  }, []);

  useEffect(() => {
    if (step === 1) loadJobs(jobDate);
  }, [step, jobDate]);

  function reset() {
    clearPhotoDetails();
    setStep(0); setJob(null); setQuery(''); setPanel({ name: 'Main Panel', manufacturer: 'Unknown', mainAmps: '', spaces: '', labels: 'Partial' });
    setOverview(null); setLeftPhotos([]); setRightPhotos([]); setDirectory(null); setSending(false); setSendError(''); setSavedRecord(null); setProcessing(false); setActivityOpen(false); setLocalNotice('');
  }

  function buildQueuedRecord() {
    const recordId = `PNL-${job.id}-${Date.now().toString(36).toUpperCase()}`;
    const capturedAt = new Date().toISOString();
    const photoManifest = [
      { key: 'overview', title: 'Full Panel Overview', status: overview ? 'Captured' : 'Missing' },
      ...leftPhotos.map((_, i) => ({ key: `left-${i + 1}`, title: `Left Breakers ${i + 1}`, status: 'Captured' })),
      ...rightPhotos.map((_, i) => ({ key: `right-${i + 1}`, title: `Right Breakers ${i + 1}`, status: 'Captured' })),
      ...['manufacturer', 'directory'].map((key) => ({ key, title: key === 'manufacturer' ? 'Manufacturer Label' : 'Existing Panel Directory', status: (key === 'manufacturer' ? manufacturerPhoto : directory) ? 'Captured' : 'Not available', reason: (key === 'manufacturer' ? manufacturerPhoto : directory) ? '' : unavailableReason(unavailable[key]) })),
    ];
    const skippedPhotos = Object.fromEntries(photoManifest.filter((item) => item.status === 'Not available').map((item) => [item.key, item.reason]));
    const record = { recordId, capturedAt, capturedBy: '', job, panel, capturedCount, skippedCount: Object.keys(skippedPhotos).length, skippedPhotos, photoSteps: photoManifest,
      photoRulesVersion: PHOTO_RULES_VERSION, photoGuidance: guidance, coverageConfirmed, qualityExceptions };
    const photos = [];
    const add = (key, file, sort) => {
      if (!file) return;
      const extension = file.name?.includes('.') ? file.name.split('.').pop() : 'jpg';
      const name = `${String(sort).padStart(2, '0')}-${key}.${extension}`;
      photos.push({ file, name, type: file.type || 'image/jpeg' });
      Object.assign(photoManifest.find((item) => item.key === key), { filename: name, quality: photoChecks.get(file) });
    };
    add('overview', overview, 1);
    leftPhotos.forEach((file, i) => add(`left-${i + 1}`, file, 10 + i));
    rightPhotos.forEach((file, i) => add(`right-${i + 1}`, file, 30 + i));
    add('manufacturer', manufacturerPhoto, 80);
    add('directory', directory, 90);
    return { recordId, record, photos, savedLocallyAt: new Date().toISOString() };
  }

  async function saveAndSend() {
    if (!complete || sending) return;
    setSending(true);
    setSendError('');
    setLocalNotice('');
    const queued = buildQueuedRecord();
    try {
      await savePendingPanel(queued);
      await refreshLocalPanels();
      if (!navigator.onLine) {
        setLocalNotice('Saved on this device. It will upload automatically when data service returns.');
        resetAfterLocalSave();
        return;
      }
      try {
        const result = await uploadQueuedItem(queued);
        setSavedRecord(result);
        await refreshLocalPanels();
        setProcessing(true);
      } catch (error) {
        setLocalNotice('Upload could not finish, so the complete panel is still saved safely on this device and will retry later.');
        setSendError(error.message);
      }
    } catch (error) {
      setSendError(`Could not save the panel locally: ${error.message}`);
    } finally {
      setSending(false);
    }
  }

  function resetAfterLocalSave() {
    clearPhotoDetails();
    setOverview(null); setLeftPhotos([]); setRightPhotos([]); setDirectory(null); setStep(0); setJob(null);
  }

  function reviewUploadedPanel(item) {
    setJob(item.record?.job || null);
    setPanel(item.record?.panel || { name: 'Panel', manufacturer: 'Unknown', mainAmps: '', spaces: '' });
    setSavedRecord(item.receipt || item);
    setActivityOpen(false);
    setProcessing(true);
  }

  async function uploadAndReview(item) {
    const result = await uploadQueuedItem(item);
    await refreshLocalPanels();
    reviewUploadedPanel({ ...item, status: 'uploaded', uploadedAt: new Date().toISOString(), receipt: result });
  }

  async function rememberFinalization(finalization) {
    if (!finalization?.recordId) return;
    await markPanelFinalized(finalization.recordId, finalization);
    setSavedRecord((current) => ({ ...(current || {}), finalization }));
    await refreshLocalPanels();
  }

  if (processing) {
    return (
      <div className="appShell">
        <Header step={4} onHome={reset} onUploads={() => { setProcessing(false); setActivityOpen(true); refreshLocalPanels(); }} online={online} pendingCount={pendingCount} syncing={syncing} />
        <ProcessingReview job={job} panel={panel} photoUrls={processingPhotoUrls} savedRecord={savedRecord} onFinalized={rememberFinalization} onStartOver={reset} />
      </div>
    );
  }

  if (activityOpen) {
    return (
      <div className="appShell">
        <Header step={0} onHome={reset} onUploads={() => refreshLocalPanels()} online={online} pendingCount={pendingCount} syncing={syncing} />
        <UploadActivity items={localPanels} online={online} syncing={syncing} onBack={reset} onRefresh={syncPending} onUpload={uploadAndReview} onReview={reviewUploadedPanel} />
      </div>
    );
  }

  return (
    <div className="appShell">
      <Header step={step} onHome={reset} onUploads={() => { setActivityOpen(true); refreshLocalPanels(); }} online={online} pendingCount={pendingCount} syncing={syncing} />
      <main className="content">
        {localNotice && <div className="infoStrip" style={{ marginBottom: 18 }}><strong>Offline record:</strong> {localNotice}</div>}
        {step === 0 && (
          <section>
            <p className="eyebrow">Field tool</p>
            <h1>Create a clean panel directory with fewer photos.</h1>
            <p className="lead">Capture one overview, then take only as many breaker photos as needed on the left and right sides. The app keeps working in basement dead zones and syncs later.</p>
            <button className="primary large" onClick={() => setStep(1)}>Start Panel Label</button>
            <div className="homeLinks">
              <button type="button" className="secondary" onClick={() => { setActivityOpen(true); refreshLocalPanels(); }}>Pending / Recently Uploaded{pendingCount ? ` (${pendingCount})` : ''}</button>
              <a className="secondary" href="/past-records">Past Jobs</a>
            </div>
            {pendingCount > 0 && <div className="infoStrip"><strong>{pendingCount} panel{pendingCount === 1 ? '' : 's'} waiting to upload.</strong> {online ? 'Sync will retry automatically.' : 'They are stored on this device until service returns.'}</div>}
          </section>
        )}

        {step === 1 && (
          <section>
            <p className="eyebrow">1 · Identify the job</p><h1>Which job are you on?</h1>
            <p className="muted">Load the job before entering a dead zone. Once loaded, panel setup and photos work without data.</p>
            <label className="dateField">Appointment date<input type="date" value={jobDate} onChange={(e) => setJobDate(e.target.value)} /></label>
            <input className="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search job #, customer, or address" />
            {jobsLoading && <div className="jobState">Loading ServiceTitan appointments…</div>}
            {!jobsLoading && jobsError && <div className={`jobState ${jobsSource === 'cached' ? 'warning' : 'error'}`}><span>{jobsError}</span><button type="button" onClick={() => loadJobs(jobDate)}>Try again</button></div>}
            {!jobsLoading && !jobsError && jobsSource === 'live' && <div className="jobSource">Live from ServiceTitan · {jobs.length} appointment{jobs.length === 1 ? '' : 's'}</div>}
            {!jobsLoading && !jobsError && jobs.length === 0 && <div className="jobState">No ServiceTitan appointments were found for this date.</div>}
            {!jobsLoading && jobs.length > 0 && filteredJobs.length === 0 && <div className="jobState">No loaded appointments match that search.</div>}
            <div className="jobs">{filteredJobs.map((j) => <button key={`${j.appointmentId}-${j.serviceTitanId}`} className={`jobCard ${job?.appointmentId === j.appointmentId ? 'selected' : ''}`} onClick={() => setJob(j)}><div className="jobTime">{j.time}<small>{j.status}</small></div><div className="jobMain"><strong>{j.customer}</strong><span>{j.address}</span><small>Job #{j.id}{j.summary ? ` · ${j.summary}` : ''}</small></div><div className="chev">›</div></button>)}</div>
            <div className="bottomActions"><button className="secondary" onClick={() => setStep(0)}>Back</button><button className="primary" disabled={!job} onClick={() => setStep(2)}>Confirm Job</button></div>
          </section>
        )}

        {step === 2 && (
          <section>
            <p className="eyebrow">2 · Panel setup</p><h1>Which panel is this?</h1>
            <div className="jobBanner"><strong>{job.customer}</strong><span>{job.address}</span><small>Job #{job.id}</small></div>
            <div className="formGrid">
              <label>Panel name<input value={panel.name} onChange={(e) => setPanel({ ...panel, name: e.target.value })} /></label>
              <label>Approx. breaker spaces (optional)<input inputMode="numeric" value={panel.spaces} onChange={(e) => setPanel({ ...panel, spaces: e.target.value })} placeholder="e.g. 12, 30, 42 — blank if unknown" /></label>
              <label>Manufacturer (optional)<select value={panel.manufacturer} onChange={(e) => setPanel({ ...panel, manufacturer: e.target.value })}>{manufacturers.map((m) => <option key={m}>{m}</option>)}</select></label>
              <label>Main breaker amps (optional)<input inputMode="numeric" value={panel.mainAmps} onChange={(e) => setPanel({ ...panel, mainAmps: e.target.value })} placeholder="200" /></label>
            </div>
            <div className="tips"><strong>Photo plan</strong><span>{guidance.text}</span><span>Count physical spaces, including blanks. Photograph tandem markings closely.</span></div>
            <div className="bottomActions"><button className="secondary" onClick={() => setStep(1)}>Back</button><button className="primary" onClick={() => setStep(3)}>Take Photos</button></div>
          </section>
        )}

        {step === 3 && (
          <section>
            <p className="eyebrow">3 · Panel photos</p><h1>Photograph what the AI needs.</h1>
            <p className="lead compact">Complete breaker coverage matters more than a fixed photo count. Photos stay on this device until a confirmed upload succeeds.</p>
            <div className="photoPlan"><strong>{guidance.spaces ? `${guidance.spaces}-space panel` : 'Panel size unknown'}</strong><p>{guidance.text}</p><span>Also capture an overview and the manufacturer and directory labels, or record why each label is unavailable.</span></div>
            <div style={{ display: 'grid', gap: 18 }}>
              <div className="completionCard" style={{ display: 'grid' }}><div><strong>1. Full panel overview</strong><span>One photo showing the whole open panel.</span></div>{overview ? <PhotoTile file={overview} {...photoProps(overview)} label="Overview" onRemove={() => setOverview(null)} /> : <AddPhotoButton onFiles={(files) => setOverview(files[0] || null)}>Take overview photo</AddPhotoButton>}</div>
              <div className="completionCard" style={{ display: 'grid' }}><div><strong>2. Left-side breakers</strong><span>{leftPhotos.length} taken{guidance.perSide ? ` · Suggested: ${guidance.perSide}` : ''}. Cover the full left column, top to bottom. Overlap slightly.</span></div>{leftPhotos.length > 0 && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 8 }}>{leftPhotos.map((file, i) => <PhotoTile key={`${file.name}-${i}`} file={file} {...photoProps(file)} label={`Left ${i + 1}`} onRemove={() => setLeftPhotos((p) => p.filter((_, n) => n !== i))} />)}</div>}<AddPhotoButton multiple onFiles={(files) => setLeftPhotos((p) => [...p, ...files])}>+ Add left breaker photo</AddPhotoButton></div>
              <div className="completionCard" style={{ display: 'grid' }}><div><strong>3. Right-side breakers</strong><span>{rightPhotos.length} taken{guidance.perSide ? ` · Suggested: ${guidance.perSide}` : ''}. Cover the full right column. Make breaker markings readable.</span></div>{rightPhotos.length > 0 && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 8 }}>{rightPhotos.map((file, i) => <PhotoTile key={`${file.name}-${i}`} file={file} {...photoProps(file)} label={`Right ${i + 1}`} onRemove={() => setRightPhotos((p) => p.filter((_, n) => n !== i))} />)}</div>}<AddPhotoButton multiple onFiles={(files) => setRightPhotos((p) => [...p, ...files])}>+ Add right breaker photo</AddPhotoButton></div>
              <div className="completionCard" style={{ display: 'grid' }}><div><strong>4. Manufacturer label</strong><span>Show the brand, model, and ratings label. If unavailable, select a reason.</span></div>{manufacturerPhoto ? <PhotoTile file={manufacturerPhoto} {...photoProps(manufacturerPhoto)} label="Manufacturer label" onRemove={() => setManufacturerPhoto(null)} /> : <><AddPhotoButton onFiles={(files) => { setManufacturerPhoto(files[0] || null); setUnavailable((p) => ({ ...p, manufacturer: { reason: '', details: '' } })); }}>Take manufacturer label photo</AddPhotoButton><UnavailablePhoto label="Manufacturer" value={unavailable.manufacturer} onChange={(value) => setUnavailable((p) => ({ ...p, manufacturer: value }))} /></>}</div>
              <div className="completionCard" style={{ display: 'grid' }}><div><strong>5. Existing panel directory</strong><span>Show the written circuit list. If unavailable, select a reason.</span></div>{directory ? <PhotoTile file={directory} {...photoProps(directory)} label="Existing directory" onRemove={() => setDirectory(null)} /> : <><AddPhotoButton onFiles={(files) => { setDirectory(files[0] || null); setUnavailable((p) => ({ ...p, directory: { reason: '', details: '' } })); }}>Take directory photo</AddPhotoButton><UnavailablePhoto label="Directory" value={unavailable.directory} onChange={(value) => setUnavailable((p) => ({ ...p, directory: value }))} /></>}</div>
            </div>
            <div className="tips"><strong>Check before leaving the panel</strong><span>Automatic checks screen for blur, glare, darkness, and low detail. They cannot confirm that text is readable. Enlarge photos to check the lettering.</span></div>
            <label className="photoCheck coverageCheck"><input type="checkbox" checked={coverageConfirmed} onChange={(e) => setCoverageConfirmed(e.target.checked)} />I checked top-to-bottom coverage on both sides and can read the markings and labels, except photos flagged for review.</label>
            {!complete && <p className="photoHelp" role="status">To continue: add an overview and both breaker sides, photograph both labels or give reasons, resolve photo warnings, and confirm coverage.</p>}
            {capturedCount > MAX_PHOTOS && <p className="sendError" role="alert">{capturedCount} photos selected. Remove duplicates to stay within the {MAX_PHOTOS}-photo upload limit.</p>}
            <div className="bottomActions"><button className="secondary" onClick={() => setStep(2)}>Back</button><button className="primary" disabled={!complete} onClick={() => setStep(4)}>Review Photos</button></div>
          </section>
        )}

        {step === 4 && (
          <section>
            <p className="eyebrow">4 · Save & process</p><h1>{online ? 'Ready to upload.' : 'Ready to save offline.'}</h1>
            <div className="completionCard"><div className="completionNumber">{capturedCount}</div><div><strong>Photos captured</strong><span>Overview: yes · Left: {leftPhotos.length} · Right: {rightPhotos.length} · Manufacturer: {manufacturerPhoto ? 'photo' : unavailableReason(unavailable.manufacturer)} · Directory: {directory ? 'photo' : unavailableReason(unavailable.directory)}</span></div></div>
            <div className="tips"><strong>Photo review saved with this record</strong><span>Coverage confirmed · {qualityExceptions} photo{qualityExceptions === 1 ? '' : 's'} flagged for review. Label-unavailable reasons and quality results will be saved with the photos.</span></div>
            <div className="infoStrip"><strong>{online ? 'Online:' : 'Offline:'}</strong> {online ? 'The app saves locally first, uploads to SharePoint, then clears the local photo blobs only after the server confirms success.' : 'The full panel record and photos will remain on this phone and automatically upload when service returns.'}</div>
            <div className="bottomActions"><button className="secondary" onClick={() => setStep(3)}>Back</button><button className="primary sendButton" disabled={!complete || sending} onClick={saveAndSend}>{sending ? 'Saving…' : online ? 'Save, Upload & Build Label' : 'Save Offline'}</button></div>
            {sendError && <div className="sendError" role="alert"><strong>Panel remains saved locally</strong><span>{sendError}</span><button type="button" onClick={saveAndSend}>Try again</button></div>}
          </section>
        )}
      </main>
    </div>
  );
}
