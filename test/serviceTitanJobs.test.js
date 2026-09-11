import test from 'node:test';
import assert from 'node:assert/strict';
import { buildJobChoices, formatAddress, isIsoDate } from '../serviceTitanJobs.js';

test('validates date-only appointment filters', () => {
  assert.equal(isIsoDate('2026-09-11'), true);
  assert.equal(isIsoDate('2026-02-30'), false);
  assert.equal(isIsoDate('09/11/2026'), false);
});

test('formats a ServiceTitan service location address', () => {
  assert.equal(formatAddress({ address: { street: '123 Main St', unit: 'Apt 2', city: 'Philadelphia', state: 'PA', zip: '19103' } }), '123 Main St Apt 2 Philadelphia, PA 19103');
});

test('preserves ServiceTitan local appointment wall time when no offset is supplied', () => {
  const [choice] = buildJobChoices({
    appointments: [{ id: 1, jobId: 2, start: '2026-01-10T09:15:00', status: 'Scheduled' }],
    jobs: [{ id: 2, jobNumber: '3' }],
  });
  assert.equal(choice.time, '9:15 AM');
});

test('joins appointments to real ServiceTitan jobs, customers, and locations', () => {
  const result = buildJobChoices({
    appointments: [
      { id: 901, jobId: 501, start: '2026-09-11T14:30:00Z', end: '2026-09-11T16:30:00Z', status: 'Scheduled' },
      { id: 902, jobId: 502, start: '2026-09-11T12:00:00Z', status: 'Canceled' },
    ],
    jobs: [{ id: 501, jobNumber: '12345678', customerId: 301, locationId: 401, summary: 'Electrical panel assessment' }],
    customers: [{ id: 301, name: 'Real Customer' }],
    locations: [{ id: 401, address: { street: '10 Market St', city: 'Philadelphia', state: 'PA', zip: '19106' } }],
  });

  assert.equal(result.length, 1);
  assert.deepEqual(result[0], {
    id: '12345678', serviceTitanId: '501', appointmentId: '901', appointmentNumber: '',
    start: '2026-09-11T14:30:00Z', end: '2026-09-11T16:30:00Z', time: '10:30 AM',
    customer: 'Real Customer', address: '10 Market St Philadelphia, PA 19106', status: 'Scheduled',
    summary: 'Electrical panel assessment', customerId: '301', locationId: '401',
  });
});
