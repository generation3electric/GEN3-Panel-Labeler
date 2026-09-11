import React, { useEffect, useMemo, useRef, useState } from 'react';
import ProcessingReview from './ProcessingReview.jsx';
import UploadActivity from './UploadActivity.jsx';
import { getAllLocalPanels, getPendingPanels, markPanelUploaded, panelToFormData, savePendingPanel } from './offlineQueue.js';

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

function PhotoTile({ file, label, onRemove }) {
  const url = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return (
    <div style={{ background: '#fff', border: '1px solid #dbe4ea', borderRadius: 12, padding: 8 }}>
      <img src={url} alt={label} style={{ width: '100%', height: 170, objectFit: 'cover', borderRadius: 9, background: '#102b47' }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', marginTop: 7 }}>
        <small style={{ color: '#607487', fontWeight: 800 }}>{label}</small>
        <button type="button" onClick={onRemove} style={{ border: 0, background: 'transparent', color: '#9b351c', fontWeight: 800 }}>Remove</button>
      </div>
    </div>
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
  const capturedCount = (overview ? 1 : 0) + leftPhotos.length + rightPhotos.length + (directory ? 1 : 0);
  const complete = Boolean(overview && leftPhotos.length && rightPhotos.length);

  const processingPhotoUrls = useMemo(() => {
    const result = {};
    if (overview) result.breakerField = URL.createObjectURL(overview);
    leftPhotos.forEach((file, i) => { result[`left-${i + 1}`] = URL.createObjectURL(file); });
    rightPhotos.forEach((file, i) => { result[`right-${i + 1}`] = URL.createObjectURL(file); });
    if (directory) result.directory = URL.createObjectURL(directory);
    return result;
  }, [overview, leftPhotos, rightPhotos, directory]);

  async function refreshLocalPanels() {
    try {
      const items = await getAllLocalPanels();
      setLocalPanels(items);
      setPendingCount(items.filter((item) => item.status !== 'uploaded').length);
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
      { key: 'directory', title: 'Existing Panel Label', status: directory ? 'Captured' : 'Optional / not provided' },
    ];
    const record = { recordId, capturedAt, capturedBy: '', job, panel, capturedCount, skippedCount: directory ? 0 : 1, skippedPhotos: directory ? {} : { directory: 'Optional / not provided' }, photoSteps: photoManifest };
    const photos = [];
    const add = (key, file, sort) => {
      if (!file) return;
      const extension = file.name?.includes('.') ? file.name.split('.').pop() : 'jpg';
      photos.push({ file, name: `${String(sort).padStart(2, '0')}-${key}.${extension}`, type: file.type || 'image/jpeg' });
    };
    add('overview', overview, 1);
    leftPhotos.forEach((file, i) => add(`left-${i + 1}`, file, 10 + i));
    rightPhotos.forEach((file, i) => add(`right-${i + 1}`, file, 30 + i));
    add('directory', directory, 90);
    return { recordId, record, photos, savedLocallyAt: new Date().toISOString() };
  }

  async function saveAndSend() {
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

  if (processing) {
    return (
      <div className="appShell">
        <Header step={4} onHome={reset} onUploads={() => { setProcessing(false); setActivityOpen(true); refreshLocalPanels(); }} online={online} pendingCount={pendingCount} syncing={syncing} />
        <ProcessingReview job={job} panel={panel} photoUrls={processingPhotoUrls} savedRecord={savedRecord} onStartOver={reset} />
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
              <label>Approx. spaces<input inputMode="numeric" value={panel.spaces} onChange={(e) => setPanel({ ...panel, spaces: e.target.value })} placeholder="30" /></label>
              <label>Manufacturer (optional)<select value={panel.manufacturer} onChange={(e) => setPanel({ ...panel, manufacturer: e.target.value })}>{manufacturers.map((m) => <option key={m}>{m}</option>)}</select></label>
              <label>Main breaker amps (optional)<input inputMode="numeric" value={panel.mainAmps} onChange={(e) => setPanel({ ...panel, mainAmps: e.target.value })} placeholder="200" /></label>
            </div>
            <div className="bottomActions"><button className="secondary" onClick={() => setStep(1)}>Back</button><button className="primary" onClick={() => setStep(3)}>Take Photos</button></div>
          </section>
        )}

        {step === 3 && (
          <section>
            <p className="eyebrow">3 · Panel photos</p><h1>Photograph what the AI needs.</h1>
            <p className="lead compact">Complete breaker coverage matters more than a fixed photo count. Photos stay on this device until a confirmed upload succeeds.</p>
            <div style={{ display: 'grid', gap: 18 }}>
              <div className="completionCard" style={{ display: 'grid' }}><div><strong>1. Full panel overview</strong><span>One photo showing the whole open panel.</span></div>{overview ? <PhotoTile file={overview} label="Overview" onRemove={() => setOverview(null)} /> : <AddPhotoButton onFiles={(files) => setOverview(files[0] || null)}>Take overview photo</AddPhotoButton>}</div>
              <div className="completionCard" style={{ display: 'grid' }}><div><strong>2. Left-side breakers</strong><span>Take as many close-ups as needed from top to bottom. Overlap slightly.</span></div>{leftPhotos.length > 0 && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 8 }}>{leftPhotos.map((file, i) => <PhotoTile key={`${file.name}-${i}`} file={file} label={`Left ${i + 1}`} onRemove={() => setLeftPhotos((p) => p.filter((_, n) => n !== i))} />)}</div>}<AddPhotoButton multiple onFiles={(files) => setLeftPhotos((p) => [...p, ...files])}>+ Add left breaker photo</AddPhotoButton></div>
              <div className="completionCard" style={{ display: 'grid' }}><div><strong>3. Right-side breakers</strong><span>Take as many close-ups as needed. Make breaker labels readable.</span></div>{rightPhotos.length > 0 && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 8 }}>{rightPhotos.map((file, i) => <PhotoTile key={`${file.name}-${i}`} file={file} label={`Right ${i + 1}`} onRemove={() => setRightPhotos((p) => p.filter((_, n) => n !== i))} />)}</div>}<AddPhotoButton multiple onFiles={(files) => setRightPhotos((p) => [...p, ...files])}>+ Add right breaker photo</AddPhotoButton></div>
              <div className="completionCard" style={{ display: 'grid' }}><div><strong>4. Existing panel label</strong><span>Optional.</span></div>{directory ? <PhotoTile file={directory} label="Existing label" onRemove={() => setDirectory(null)} /> : <AddPhotoButton onFiles={(files) => setDirectory(files[0] || null)}>Add optional label photo</AddPhotoButton>}</div>
            </div>
            <div className="tips"><strong>Minimum needed</strong><span>1 overview + at least 1 left-side photo + at least 1 right-side photo. Larger panels can use as many as needed.</span></div>
            <div className="bottomActions"><button className="secondary" onClick={() => setStep(2)}>Back</button><button className="primary" disabled={!complete} onClick={() => setStep(4)}>Review Photos</button></div>
          </section>
        )}

        {step === 4 && (
          <section>
            <p className="eyebrow">4 · Save & process</p><h1>{online ? 'Ready to upload.' : 'Ready to save offline.'}</h1>
            <div className="completionCard"><div className="completionNumber">{capturedCount}</div><div><strong>Photos captured</strong><span>Overview: yes · Left: {leftPhotos.length} · Right: {rightPhotos.length} · Existing label: {directory ? 'yes' : 'optional'}</span></div></div>
            <div className="infoStrip"><strong>{online ? 'Online:' : 'Offline:'}</strong> {online ? 'The app saves locally first, uploads to SharePoint, then clears the local photo blobs only after the server confirms success.' : 'The full panel record and photos will remain on this phone and automatically upload when service returns.'}</div>
            <div className="bottomActions"><button className="secondary" onClick={() => setStep(3)}>Back</button><button className="primary sendButton" disabled={!complete || sending} onClick={saveAndSend}>{sending ? 'Saving…' : online ? 'Save, Upload & Build Label' : 'Save Offline'}</button></div>
            {sendError && <div className="sendError" role="alert"><strong>Panel remains saved locally</strong><span>{sendError}</span><button type="button" onClick={saveAndSend}>Try again</button></div>}
          </section>
        )}
      </main>
    </div>
  );
}
