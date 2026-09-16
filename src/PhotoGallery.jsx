import React, { useEffect, useMemo, useRef, useState } from 'react';
import { photoLabel } from './photoGallery.js';
import './PhotoGallery.css';

const EMPTY = {};
const NO_FILES = [];

function GalleryImage({ photo }) {
  const [failed, setFailed] = useState(false);
  return failed ? <span className="galleryImageError">Preview unavailable. Try opening the original photo.</span> :
    <img src={photo.url} alt={photo.label} loading="lazy" onError={() => setFailed(true)} />;
}

export default function PhotoGallery({ photoUrls = EMPTY, localPhotos = NO_FILES, itemId, folderUrl, openPhoto }) {
  const [remotePhotos, setRemotePhotos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState(0);
  const [zoomed, setZoomed] = useState(false);
  const dialog = useRef(null);
  const openedRequest = useRef(null);
  const [photoNotice, setPhotoNotice] = useState('');
  const local = useMemo(() => localPhotos.filter((photo) => photo.file instanceof Blob).map((photo) => ({
    id: photo.name, label: photoLabel(photo.name), url: URL.createObjectURL(photo.file),
  })), [localPhotos]);
  useEffect(() => () => local.forEach((photo) => URL.revokeObjectURL(photo.url)), [local]);
  const supplied = useMemo(() => Object.entries(photoUrls).filter(([, url]) => url).map(([key, url]) => ({ id: key, label: photoLabel(key), url })), [photoUrls]);
  const hasLocal = local.length > 0 || supplied.length > 0;

  useEffect(() => {
    setRemotePhotos([]);
    setError('');
    setLoading(false);
    if (hasLocal || !itemId) return;
    const controller = new AbortController();
    setLoading(true);
    fetch(`/api/sharepoint/panel-records/${encodeURIComponent(itemId)}/photos`, { signal: controller.signal, headers: { Accept: 'application/json' } })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Could not load photos.');
        if (!controller.signal.aborted) setRemotePhotos(data.photos || []);
      }).catch((err) => { if (!controller.signal.aborted) setError(err.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [itemId, hasLocal, attempt]);

  const photos = local.length ? local : supplied.length ? supplied : remotePhotos;
  useEffect(() => {
    if (!openPhoto || openedRequest.current === openPhoto || loading) return;
    const label = photoLabel(openPhoto.name);
    const index = photos.findIndex((photo) => photo.name === openPhoto.name || photo.id === openPhoto.name || photo.label === label);
    openedRequest.current = openPhoto;
    if (index < 0) { setPhotoNotice('The referenced photo is unavailable. Check the gallery or SharePoint folder.'); return; }
    setPhotoNotice(''); setSelected(index); setZoomed(false);
    if (!dialog.current.open) dialog.current.showModal();
  }, [openPhoto, photos, loading]);
  const current = photos[selected];
  function move(delta) { setSelected((index) => Math.max(0, Math.min(photos.length - 1, index + delta))); setZoomed(false); }

  return <section className="panelPhotoGallery noPrint" aria-label="Panel photos">
    <div className="galleryHeading"><h2>All Photos{photos.length ? ` (${photos.length})` : ''}</h2><span>Tap a photo to enlarge</span></div>
    {photoNotice && <p role="alert">{photoNotice}</p>}
    {loading && <p role="status">Loading panel photos…</p>}
    {error && <div role="alert"><p>{error}</p><button className="secondary" type="button" onClick={() => setAttempt((value) => value + 1)}>Try again</button></div>}
    {!loading && !error && !photos.length && <p>No photos are available for this panel.</p>}
    <div className="galleryGrid">{photos.map((photo, index) => <button className="galleryTile" key={photo.id} type="button" aria-label={`Enlarge ${photo.label}`} onClick={() => { setSelected(index); setZoomed(false); dialog.current.showModal(); }}>
      <GalleryImage key={photo.url} photo={photo} /><span>{photo.label}</span>
    </button>)}</div>
    {folderUrl && <a className="gallerySource" href={folderUrl} target="_blank" rel="noreferrer">Open photo folder in SharePoint</a>}
    <dialog className="galleryDialog" ref={dialog} aria-label="Enlarged panel photo" onKeyDown={(event) => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); move(event.key === 'ArrowLeft' ? -1 : 1); }
    }}>
      <div className="galleryToolbar"><strong>{current?.label}</strong><button className="secondary" type="button" onClick={() => dialog.current.close()}>Close</button></div>
      <div className={`galleryViewport ${zoomed ? 'zoomed' : ''}`}>{current && <GalleryImage key={current.url} photo={current} />}</div>
      <div className="galleryToolbar">
        <button className="secondary" type="button" disabled={selected === 0} onClick={() => move(-1)}>Previous</button>
        <span aria-live="polite">{selected + 1} / {photos.length}</span>
        <button className="secondary" type="button" disabled={selected >= photos.length - 1} onClick={() => move(1)}>Next</button>
      </div>
      <div className="galleryToolbar"><button className="secondary" type="button" aria-pressed={zoomed} onClick={() => setZoomed(!zoomed)}>{zoomed ? 'Fit photo' : 'Zoom in'}</button>{current && <a href={current.url} target="_blank" rel="noreferrer">Open original photo</a>}</div>
    </dialog>
  </section>;
}
