import React, { useMemo, useState } from 'react';
import ProcessingReview from './ProcessingReview.jsx';

const sampleJobs = [
  { id: '7845621', time: '10:00 AM', customer: 'John Smith', address: '1428 Pine Street, Philadelphia, PA 19102' },
  { id: '7845688', time: '1:00 PM', customer: 'Maria Jones', address: '2207 S 18th Street, Philadelphia, PA 19145' },
  { id: '7845713', time: '3:30 PM', customer: 'David Williams', address: '7812 Germantown Avenue, Philadelphia, PA 19118' },
];

const manufacturers = ['Unknown', 'Square D', 'Eaton / Cutler-Hammer', 'Siemens', 'GE', 'Federal Pacific', 'Zinsco', 'Other'];

function Header({ step, onHome }) {
  return (
    <header className="topbar">
      <button className="brand" onClick={onHome} aria-label="Go home">
        <span className="bolt">⚡</span>
        <span><strong>GEN3</strong><small>Panel Labeler</small></span>
      </button>
      {step > 0 && <div className="stepPill">Step {Math.min(step, 4)} of 4</div>}
    </header>
  );
}

function PhotoTile({ file, label, onRemove }) {
  const url = useMemo(() => URL.createObjectURL(file), [file]);
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
  const [panel, setPanel] = useState({ name: 'Main Panel', manufacturer: 'Unknown', mainAmps: '', spaces: '', labels: 'Partial' });
  const [overview, setOverview] = useState(null);
  const [leftPhotos, setLeftPhotos] = useState([]);
  const [rightPhotos, setRightPhotos] = useState([]);
  const [directory, setDirectory] = useState(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [savedRecord, setSavedRecord] = useState(null);
  const [processing, setProcessing] = useState(false);

  const filteredJobs = sampleJobs.filter((j) => `${j.id} ${j.customer} ${j.address}`.toLowerCase().includes(query.toLowerCase()));
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

  function reset() {
    setStep(0); setJob(null); setQuery(''); setPanel({ name: 'Main Panel', manufacturer: 'Unknown', mainAmps: '', spaces: '', labels: 'Partial' });
    setOverview(null); setLeftPhotos([]); setRightPhotos([]); setDirectory(null); setSending(false); setSendError(''); setSavedRecord(null); setProcessing(false);
  }

  async function sendToSharePoint() {
    setSending(true);
    setSendError('');
    const recordId = `PNL-${job.id}-${Date.now().toString(36).toUpperCase()}`;
    const capturedAt = new Date().toISOString();
    const form = new FormData();
    const photoManifest = [
      { key: 'overview', title: 'Full Panel Overview', status: overview ? 'Captured' : 'Missing' },
      ...leftPhotos.map((_, i) => ({ key: `left-${i + 1}`, title: `Left Breakers ${i + 1}`, status: 'Captured' })),
      ...rightPhotos.map((_, i) => ({ key: `right-${i + 1}`, title: `Right Breakers ${i + 1}`, status: 'Captured' })),
      { key: 'directory', title: 'Existing Panel Label', status: directory ? 'Captured' : 'Optional / not provided' },
    ];
    form.append('record', JSON.stringify({ recordId, capturedAt, capturedBy: '', job, panel, capturedCount, skippedCount: directory ? 0 : 1, skippedPhotos: directory ? {} : { directory: 'Optional / not provided' }, photoSteps: photoManifest }));

    const appendFile = (key, file, sort) => {
      if (!file) return;
      const extension = file.name?.includes('.') ? file.name.split('.').pop() : 'jpg';
      form.append('photos', file, `${String(sort).padStart(2, '0')}-${key}.${extension}`);
    };
    appendFile('overview', overview, 1);
    leftPhotos.forEach((file, i) => appendFile(`left-${i + 1}`, file, 10 + i));
    rightPhotos.forEach((file, i) => appendFile(`right-${i + 1}`, file, 30 + i));
    appendFile('directory', directory, 90);

    try {
      const response = await fetch('/api/sharepoint/panel-records', { method: 'POST', body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'The record could not be sent.');
      setSavedRecord(result);
      setProcessing(true);
    } catch (error) {
      setSendError(error.message);
    } finally {
      setSending(false);
    }
  }

  if (processing) {
    return (
      <div className="appShell">
        <Header step={4} onHome={reset} />
        <ProcessingReview job={job} panel={panel} photoUrls={processingPhotoUrls} savedRecord={savedRecord} onStartOver={reset} />
      </div>
    );
  }

  return (
    <div className="appShell">
      <Header step={step} onHome={reset} />
      <main className="content">
        {step === 0 && (
          <section>
            <p className="eyebrow">Field tool</p>
            <h1>Create a clean panel directory with fewer photos.</h1>
            <p className="lead">Capture one overview, then take only as many breaker photos as needed on the left and right sides. AI uses those photos to build the typed directory.</p>
            <button className="primary large" onClick={() => setStep(1)}>Start Panel Label</button>
          </section>
        )}

        {step === 1 && (
          <section>
            <p className="eyebrow">1 · Identify the job</p>
            <h1>Which job are you on?</h1>
            <p className="muted">These are sample jobs for now. This screen is ready to be replaced by live ServiceTitan appointments.</p>
            <input className="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search job #, customer, or address" />
            <div className="jobs">{filteredJobs.map((j) => (
              <button key={j.id} className={`jobCard ${job?.id === j.id ? 'selected' : ''}`} onClick={() => setJob(j)}>
                <div className="jobTime">{j.time}</div><div className="jobMain"><strong>{j.customer}</strong><span>{j.address}</span><small>Job #{j.id}</small></div><div className="chev">›</div>
              </button>
            ))}</div>
            <div className="bottomActions"><button className="secondary" onClick={() => setStep(0)}>Back</button><button className="primary" disabled={!job} onClick={() => setStep(2)}>Confirm Job</button></div>
          </section>
        )}

        {step === 2 && (
          <section>
            <p className="eyebrow">2 · Panel setup</p>
            <h1>Which panel is this?</h1>
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
            <p className="eyebrow">3 · Panel photos</p>
            <h1>Photograph what the AI needs.</h1>
            <p className="lead compact">The goal is complete breaker coverage, not a fixed number of pictures. Keep each image square to the panel and make the breaker stickers readable.</p>

            <div style={{ display: 'grid', gap: 18 }}>
              <div className="completionCard" style={{ display: 'grid' }}>
                <div><strong>1. Full panel overview</strong><span>One photo from far enough back to show the whole open panel.</span></div>
                {overview ? <PhotoTile file={overview} label="Overview" onRemove={() => setOverview(null)} /> : <AddPhotoButton onFiles={(files) => setOverview(files[0] || null)}>Take overview photo</AddPhotoButton>}
              </div>

              <div className="completionCard" style={{ display: 'grid' }}>
                <div><strong>2. Left-side breakers</strong><span>Take as many close-ups as needed from top to bottom. Overlap slightly so nothing is missed.</span></div>
                {leftPhotos.length > 0 && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 8 }}>{leftPhotos.map((file, i) => <PhotoTile key={`${file.name}-${i}`} file={file} label={`Left ${i + 1}`} onRemove={() => setLeftPhotos((p) => p.filter((_, n) => n !== i))} />)}</div>}
                <AddPhotoButton multiple onFiles={(files) => setLeftPhotos((p) => [...p, ...files])}>+ Add left breaker photo</AddPhotoButton>
              </div>

              <div className="completionCard" style={{ display: 'grid' }}>
                <div><strong>3. Right-side breakers</strong><span>Take as many close-ups as needed from top to bottom. Make sure labels beside the breakers are readable.</span></div>
                {rightPhotos.length > 0 && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 8 }}>{rightPhotos.map((file, i) => <PhotoTile key={`${file.name}-${i}`} file={file} label={`Right ${i + 1}`} onRemove={() => setRightPhotos((p) => p.filter((_, n) => n !== i))} />)}</div>}
                <AddPhotoButton multiple onFiles={(files) => setRightPhotos((p) => [...p, ...files])}>+ Add right breaker photo</AddPhotoButton>
              </div>

              <div className="completionCard" style={{ display: 'grid' }}>
                <div><strong>4. Existing panel label</strong><span>Optional. Add it only if there is an existing directory worth capturing.</span></div>
                {directory ? <PhotoTile file={directory} label="Existing label" onRemove={() => setDirectory(null)} /> : <AddPhotoButton onFiles={(files) => setDirectory(files[0] || null)}>Add optional label photo</AddPhotoButton>}
              </div>
            </div>

            <div className="tips"><strong>Minimum needed</strong><span>1 overview + at least 1 left-side photo + at least 1 right-side photo. Larger panels can use 2, 3, 4 or more photos per side.</span></div>
            <div className="bottomActions"><button className="secondary" onClick={() => setStep(2)}>Back</button><button className="primary" disabled={!complete} onClick={() => setStep(4)}>Review Photos</button></div>
          </section>
        )}

        {step === 4 && (
          <section>
            <p className="eyebrow">4 · Review & process</p>
            <h1>Ready to build the typed label.</h1>
            <div className="completionCard"><div className="completionNumber">{capturedCount}</div><div><strong>Photos captured</strong><span>Overview: {overview ? 'yes' : 'no'} · Left: {leftPhotos.length} · Right: {rightPhotos.length} · Existing label: {directory ? 'yes' : 'optional'}</span></div></div>
            <div className="infoStrip"><strong>Next:</strong> Send the field record to SharePoint, then open the AI verification screen to identify breaker positions, amperages, breaker types and circuit descriptions before the final directory is printed.</div>
            <div className="bottomActions"><button className="secondary" onClick={() => setStep(3)}>Back</button><button className="primary sendButton" disabled={!complete || sending} onClick={sendToSharePoint}>{sending ? 'Sending…' : 'Send & Build Label'}</button></div>
            {sendError && <div className="sendError" role="alert"><strong>Could not send</strong><span>{sendError}</span><button type="button" onClick={sendToSharePoint}>Try again</button></div>}
          </section>
        )}
      </main>
    </div>
  );
}
