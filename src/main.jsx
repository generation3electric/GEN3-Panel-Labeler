import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import ProcessingReview from './ProcessingReview.jsx';
import PastRecords from './PastRecords.jsx';
import './styles.css';

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => console.warn('Offline service worker registration failed:', error));
  });
}

const pathname = window.location.pathname;
const processingPreview = pathname === '/processing-preview';
const pastRecords = pathname === '/past-records';

const demoJob = {
  id: '7845621',
  customer: 'John Smith',
  address: '1428 Pine Street, Philadelphia, PA 19102',
};

const demoPanel = {
  name: 'Main Panel',
  manufacturer: 'Square D',
  mainAmps: '200',
  spaces: '30',
};

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {pastRecords ? (
      <PastRecords />
    ) : processingPreview ? (
      <ProcessingReview
        job={demoJob}
        panel={demoPanel}
        photoUrls={{}}
        savedRecord={null}
        onStartOver={() => { window.location.href = '/'; }}
      />
    ) : (
      <App />
    )}
  </React.StrictMode>,
);
