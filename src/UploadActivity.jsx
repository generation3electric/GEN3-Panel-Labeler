import React, { useMemo, useState } from 'react';
import { splitLocalPanels } from './offlineQueue.js';

function formatDate(value) {
  if (!value) return 'Unknown time';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function PanelCard({ item, online, busy, onUpload, onReview }) {
  const job = item.record?.job || {};
  const panel = item.record?.panel || {};
  const uploaded = item.status === 'uploaded';

  return (
    <article className={`uploadCard ${uploaded ? 'uploaded' : 'pending'}`}>
      <div className="uploadCardTopline">
        <span className={`uploadStatus ${uploaded ? 'uploaded' : 'pending'}`}>{uploaded ? 'Ready for review' : 'Pending upload'}</span>
        <time>{formatDate(uploaded ? item.uploadedAt : item.savedLocallyAt)}</time>
      </div>
      <h2>{job.address || 'Address not available'}</h2>
      <div className="uploadCardMeta">
        <span><b>Job</b>#{job.id || '—'}</span>
        <span><b>Panel</b>{panel.name || 'Panel'}</span>
        <span><b>Photos</b>{item.record?.capturedCount ?? item.photos?.length ?? '—'}</span>
      </div>
      {uploaded ? (
        <button className="primary uploadCardAction" onClick={() => onReview(item)}>Review AI Results <span aria-hidden="true">›</span></button>
      ) : (
        <button className="primary uploadCardAction" disabled={!online || busy} onClick={() => onUpload(item)}>
          {busy ? 'Uploading…' : online ? 'Upload & Review' : 'Waiting for Service'} <span aria-hidden="true">›</span>
        </button>
      )}
    </article>
  );
}

export default function UploadActivity({ items, online, syncing, onBack, onRefresh, onUpload, onReview }) {
  const { pending, uploaded } = useMemo(() => splitLocalPanels(items), [items]);
  const [uploadingId, setUploadingId] = useState('');
  const [error, setError] = useState('');

  async function upload(item) {
    setUploadingId(item.recordId);
    setError('');
    try {
      await onUpload(item);
    } catch (uploadError) {
      setError(uploadError.message || 'The panel could not be uploaded. It remains safely stored on this device.');
    } finally {
      setUploadingId('');
    }
  }

  return (
    <main className="content uploadActivityPage">
      <button className="activityBack" type="button" onClick={onBack}>← Panel Labeler</button>
      <p className="eyebrow">Offline return</p>
      <h1>Pending / Recently Uploaded</h1>
      <p className="lead compact">Panels captured in a dead zone stay here. Once an upload finishes, open it below to review the AI results.</p>

      <div className={`connectionBanner ${online ? 'online' : 'offline'}`}>
        <div><strong>{online ? 'Data service available' : 'No data service'}</strong><span>{online ? (pending.length ? 'Pending panels can upload now.' : 'Everything on this device is uploaded.') : 'Pending panels remain safely stored on this device.'}</span></div>
        <button type="button" onClick={onRefresh} disabled={!online || syncing || pending.length === 0}>{syncing ? 'Syncing…' : 'Sync Now'}</button>
      </div>

      {error && <div className="sendError" role="alert"><strong>Upload did not finish</strong><span>{error}</span></div>}

      <section className="activitySection">
        <div className="activitySectionTitle"><div><span>Waiting on this device</span><strong>Pending</strong></div><b>{pending.length}</b></div>
        {pending.length === 0 ? <div className="activityEmpty">No panels are waiting to upload.</div> : (
          <div className="uploadList">{pending.map((item) => <PanelCard key={item.recordId} item={item} online={online} busy={uploadingId === item.recordId} onUpload={upload} onReview={onReview} />)}</div>
        )}
      </section>

      <section className="activitySection">
        <div className="activitySectionTitle"><div><span>Uploaded from this device</span><strong>Recently Uploaded</strong></div><b>{uploaded.length}</b></div>
        {uploaded.length === 0 ? <div className="activityEmpty">Uploaded panels will appear here, ready to reopen.</div> : (
          <div className="uploadList">{uploaded.map((item) => <PanelCard key={item.recordId} item={item} online={online} busy={false} onUpload={upload} onReview={onReview} />)}</div>
        )}
      </section>
    </main>
  );
}
