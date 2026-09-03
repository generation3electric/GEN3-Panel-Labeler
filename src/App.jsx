import React, { useMemo, useState } from 'react';

const sampleJobs = [
  { id: '7845621', time: '10:00 AM', customer: 'John Smith', address: '1428 Pine Street, Philadelphia, PA 19102' },
  { id: '7845688', time: '1:00 PM', customer: 'Maria Jones', address: '2207 S 18th Street, Philadelphia, PA 19145' },
  { id: '7845713', time: '3:30 PM', customer: 'David Williams', address: '7812 Germantown Avenue, Philadelphia, PA 19118' },
];

const photoSteps = [
  { key: 'location', title: 'Panel Location', instruction: 'Stand back and show where the panel is located in the room.' },
  { key: 'exterior', title: 'Panel Exterior', instruction: 'Photograph the entire panel with the door or cover visible.' },
  { key: 'breakerField', title: 'Full Breaker Field', instruction: 'Open the panel door and photograph the breaker field straight-on.' },
  { key: 'leftTop', title: 'Left Column — Top', instruction: 'Close-up of the upper left breakers. Keep labels and breaker numbers sharp.' },
  { key: 'leftBottom', title: 'Left Column — Bottom', instruction: 'Close-up of the lower left breakers. Overlap the previous photo by about 25%.' },
  { key: 'rightTop', title: 'Right Column — Top', instruction: 'Close-up of the upper right breakers. Keep labels and breaker numbers sharp.' },
  { key: 'rightBottom', title: 'Right Column — Bottom', instruction: 'Close-up of the lower right breakers. Overlap the previous photo by about 25%.' },
  { key: 'directory', title: 'Existing Directory', instruction: 'Photograph the existing handwritten or printed panel directory.' },
  { key: 'manufacturer', title: 'Manufacturer / Model', instruction: 'Photograph the manufacturer label, model number, or identifying markings.' },
  { key: 'main', title: 'Main Breaker', instruction: 'Get a clear photo of the main breaker or service disconnect rating.' },
];

const manufacturers = ['Unknown', 'Square D', 'Eaton / Cutler-Hammer', 'Siemens', 'GE', 'Federal Pacific', 'Zinsco', 'Other'];

function Header({ step, onHome }) {
  return (
    <header className="topbar">
      <button className="brand" onClick={onHome} aria-label="Go home">
        <span className="bolt">⚡</span>
        <span><strong>GEN3</strong><small>Panel Labeler</small></span>
      </button>
      {step > 0 && <div className="stepPill">Step {step} of 4</div>}
    </header>
  );
}

export default function App() {
  const [step, setStep] = useState(0);
  const [job, setJob] = useState(null);
  const [query, setQuery] = useState('');
  const [panel, setPanel] = useState({ name: 'Main Panel', manufacturer: 'Unknown', mainAmps: '', spaces: '', labels: 'Partial' });
  const [photoIndex, setPhotoIndex] = useState(0);
  const [photos, setPhotos] = useState({});
  const [skippedPhotos, setSkippedPhotos] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [savedRecord, setSavedRecord] = useState(null);

  const filteredJobs = sampleJobs.filter((j) => `${j.id} ${j.customer} ${j.address}`.toLowerCase().includes(query.toLowerCase()));
  const capturedCount = Object.keys(photos).length;
  const skippedCount = Object.keys(skippedPhotos).length;
  const completedCount = capturedCount + skippedCount;
  const complete = completedCount === photoSteps.length;
  const currentPhoto = photoSteps[photoIndex];

  const photoUrls = useMemo(() => {
    const map = {};
    Object.entries(photos).forEach(([key, file]) => { map[key] = URL.createObjectURL(file); });
    return map;
  }, [photos]);

  function reset() {
    setStep(0); setJob(null); setQuery(''); setPanel({ name: 'Main Panel', manufacturer: 'Unknown', mainAmps: '', spaces: '', labels: 'Partial' });
    setPhotoIndex(0); setPhotos({}); setSkippedPhotos({}); setSubmitted(false); setSending(false); setSendError(''); setSavedRecord(null);
  }

  function capture(key, file) {
    if (!file) return;
    setPhotos((prev) => ({ ...prev, [key]: file }));
    setSkippedPhotos((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function goToNextPhoto() {
    if (photoIndex === photoSteps.length - 1) setStep(4);
    else setPhotoIndex(photoIndex + 1);
  }

  function skipPhoto(key) {
    setSkippedPhotos((prev) => ({ ...prev, [key]: 'Not available' }));
    setPhotos((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    goToNextPhoto();
  }

  async function sendToSharePoint() {
    setSending(true);
    setSendError('');
    const recordId = `PNL-${job.id}-${Date.now().toString(36).toUpperCase()}`;
    const capturedAt = new Date().toISOString();
    const form = new FormData();
    form.append('record', JSON.stringify({
      recordId,
      capturedAt,
      capturedBy: '',
      job,
      panel,
      capturedCount,
      skippedCount,
      skippedPhotos,
      photoSteps: photoSteps.map(({ key, title }) => ({ key, title, status: photos[key] ? 'Captured' : 'Skipped' })),
    }));
    Object.entries(photos).forEach(([key, file]) => {
      const extension = file.name?.includes('.') ? file.name.split('.').pop() : 'jpg';
      form.append('photos', file, `${String(photoSteps.findIndex((item) => item.key === key) + 1).padStart(2, '0')}-${key}.${extension}`);
    });

    try {
      const response = await fetch('/api/sharepoint/panel-records', { method: 'POST', body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'The record could not be sent.');
      setSavedRecord(result);
      setSubmitted(true);
    } catch (error) {
      setSendError(error.message);
    } finally {
      setSending(false);
    }
  }

  if (submitted) {
    return (
      <div className="appShell">
        <Header step={4} onHome={reset} />
        <main className="content successWrap">
          <div className="successIcon">✓</div>
          <p className="eyebrow">Sent to SharePoint</p>
          <h1>Panel record complete</h1>
          <p className="muted">Job #{job.id} · {job.customer}</p>
          <div className="summaryCard">
            <div><span>Location</span><strong>{job.address}</strong></div>
            <div><span>Panel</span><strong>{panel.name}</strong></div>
            <div><span>Manufacturer</span><strong>{panel.manufacturer}</strong></div>
            <div><span>Photos</span><strong>{capturedCount} captured{skippedCount ? ` · ${skippedCount} skipped` : ''}</strong></div>
          </div>
          {savedRecord?.folderUrl && <a className="sharePointLink" href={savedRecord.folderUrl} target="_blank" rel="noreferrer">Open SharePoint folder</a>}
          <button className="primary" onClick={reset}>Start Another Panel</button>
        </main>
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
            <h1>Create an accurate digital panel record.</h1>
            <p className="lead">Choose the ServiceTitan job first. The app will guide you through every photo needed for a usable panel label.</p>
            <button className="primary large" onClick={() => setStep(1)}>Start Panel Label</button>
            <div className="infoStrip"><strong>First version:</strong> job identification + guided photos. AI breaker recognition comes next.</div>
          </section>
        )}

        {step === 1 && (
          <section>
            <p className="eyebrow">1 · Identify the job</p>
            <h1>Which job are you on?</h1>
            <p className="muted">These are sample jobs for now. This screen is designed to be replaced by live ServiceTitan appointments.</p>
            <input className="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search job #, customer, or address" />
            <div className="jobs">
              {filteredJobs.map((j) => (
                <button key={j.id} className={`jobCard ${job?.id === j.id ? 'selected' : ''}`} onClick={() => setJob(j)}>
                  <div className="jobTime">{j.time}</div>
                  <div className="jobMain"><strong>{j.customer}</strong><span>{j.address}</span><small>Job #{j.id}</small></div>
                  <div className="chev">›</div>
                </button>
              ))}
            </div>
            <div className="bottomActions">
              <button className="secondary" onClick={() => setStep(0)}>Back</button>
              <button className="primary" disabled={!job} onClick={() => setStep(2)}>Confirm Job</button>
            </div>
          </section>
        )}

        {step === 2 && (
          <section>
            <p className="eyebrow">2 · Panel setup</p>
            <h1>Tell us which panel this is.</h1>
            <div className="jobBanner"><strong>{job.customer}</strong><span>{job.address}</span><small>Job #{job.id}</small></div>
            <div className="formGrid">
              <label>Panel name<input value={panel.name} onChange={(e) => setPanel({ ...panel, name: e.target.value })} placeholder="Main Panel" /></label>
              <label>Manufacturer<select value={panel.manufacturer} onChange={(e) => setPanel({ ...panel, manufacturer: e.target.value })}>{manufacturers.map((m) => <option key={m}>{m}</option>)}</select></label>
              <label>Main breaker amps<input inputMode="numeric" value={panel.mainAmps} onChange={(e) => setPanel({ ...panel, mainAmps: e.target.value })} placeholder="200" /></label>
              <label>Approx. spaces<input inputMode="numeric" value={panel.spaces} onChange={(e) => setPanel({ ...panel, spaces: e.target.value })} placeholder="40" /></label>
              <label>Existing labels<select value={panel.labels} onChange={(e) => setPanel({ ...panel, labels: e.target.value })}><option>Good</option><option>Partial</option><option>Poor</option><option>None</option></select></label>
            </div>
            <div className="bottomActions">
              <button className="secondary" onClick={() => setStep(1)}>Back</button>
              <button className="primary" onClick={() => setStep(3)}>Start Photos</button>
            </div>
          </section>
        )}

        {step === 3 && (
          <section>
            <div className="photoHeader">
              <div><p className="eyebrow">3 · Guided photos</p><h1>{currentPhoto.title}</h1></div>
              <div className="counter">{photoIndex + 1}/{photoSteps.length}</div>
            </div>
            <p className="lead compact">{currentPhoto.instruction}</p>
            <div className="progress"><span style={{ width: `${((photoIndex + 1) / photoSteps.length) * 100}%` }} /></div>
            <label className={`cameraBox ${photos[currentPhoto.key] ? 'hasPhoto' : ''}`}>
              {photos[currentPhoto.key] ? (
                <img src={photoUrls[currentPhoto.key]} alt={currentPhoto.title} />
              ) : (
                <div className="cameraPrompt"><div className="cameraIcon">▣</div><strong>Take Photo</strong><span>Use camera or choose an existing image</span></div>
              )}
              <input type="file" accept="image/*" capture="environment" onChange={(e) => capture(currentPhoto.key, e.target.files?.[0])} />
            </label>
            {photos[currentPhoto.key] && <label className="retake">Retake photo<input type="file" accept="image/*" capture="environment" onChange={(e) => capture(currentPhoto.key, e.target.files?.[0])} /></label>}
            {!photos[currentPhoto.key] && (
              <button className="skipPhoto" type="button" onClick={() => skipPhoto(currentPhoto.key)}>
                Skip — Not Available
              </button>
            )}
            {skippedPhotos[currentPhoto.key] && (
              <div className="skippedNotice"><strong>Previously skipped</strong><span>Take a photo above to replace the skipped status.</span></div>
            )}
            <div className="tips"><strong>Photo quality</strong><span>Keep the phone square to the panel, fill the frame, avoid glare, and make sure breaker text is readable.</span></div>
            <div className="bottomActions">
              <button className="secondary" onClick={() => photoIndex === 0 ? setStep(2) : setPhotoIndex(photoIndex - 1)}>Back</button>
              <button className="primary" disabled={!photos[currentPhoto.key] && !skippedPhotos[currentPhoto.key]} onClick={goToNextPhoto}>{photoIndex === photoSteps.length - 1 ? 'Review Photos' : 'Next Photo'}</button>
            </div>
          </section>
        )}

        {step === 4 && (
          <section>
            <p className="eyebrow">4 · Review</p>
            <h1>Make sure nothing is missing.</h1>
            <div className="completionCard"><div className="completionNumber">{completedCount}/{photoSteps.length}</div><div><strong>{complete ? 'Photo review complete' : 'Photos still need a decision'}</strong><span>{complete ? `${capturedCount} captured${skippedCount ? ` · ${skippedCount} not available` : ''}` : 'Capture each photo or mark it not available.'}</span></div></div>
            <div className="checklist">
              {photoSteps.map((p, i) => (
                <button key={p.key} className="checkRow" onClick={() => { setPhotoIndex(i); setStep(3); }}>
                  <span className={photos[p.key] ? 'doneDot' : skippedPhotos[p.key] ? 'skippedDot' : 'missingDot'}>{photos[p.key] ? '✓' : skippedPhotos[p.key] ? '—' : '!'}</span>
                  <span><strong>{p.title}</strong><small>{photos[p.key] ? 'Captured' : skippedPhotos[p.key] ? 'Not available — tap to add a photo' : 'Missing — tap to review'}</small></span>
                  <span className="chev">›</span>
                </button>
              ))}
            </div>
            <div className="bottomActions">
              <button className="secondary" onClick={() => { setPhotoIndex(photoSteps.length - 1); setStep(3); }}>Back</button>
              <button className="primary sendButton" disabled={!complete || sending} onClick={sendToSharePoint}>{sending ? 'Sending…' : 'Send'}</button>
            </div>
            {sendError && <div className="sendError" role="alert"><strong>Could not send</strong><span>{sendError}</span><button type="button" onClick={sendToSharePoint}>Try again</button></div>}
          </section>
        )}
      </main>
    </div>
  );
}
