import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import ProcessingReview from './ProcessingReview.jsx';
import PastRecords from './PastRecords.jsx';
import './styles.css';

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

const shortcutStyle = {
  position: 'fixed',
  right: '16px',
  top: '16px',
  zIndex: 50,
  background: '#b5d333',
  color: '#15304a',
  textDecoration: 'none',
  fontWeight: 800,
  fontSize: '13px',
  padding: '10px 14px',
  borderRadius: '18px',
  boxShadow: '0 4px 14px rgba(10,32,56,.18)',
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
      <>
        <a style={shortcutStyle} href="/past-records">Past Jobs</a>
        <App />
      </>
    )}
  </React.StrictMode>,
);
