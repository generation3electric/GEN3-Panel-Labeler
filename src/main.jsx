import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import ProcessingReview from './ProcessingReview.jsx';
import './styles.css';

const processingPreview = window.location.pathname === '/processing-preview';

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
    {processingPreview ? (
      <ProcessingReview
        job={demoJob}
        panel={demoPanel}
        photoUrls={{}}
        savedRecord={null}
        onStartOver={() => { window.location.href = '/'; }}
      />
    ) : <App />}
  </React.StrictMode>,
);