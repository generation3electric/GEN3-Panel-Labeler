const DISPLAY_TIME_ZONE = 'America/New_York';

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== '');
}

export function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function formatAddress(location = {}, job = {}) {
  const address = location.address || job.address || {};
  if (typeof address === 'string') return address.trim();

  const street = firstValue(address.street, address.streetAddress, address.addressLine1, location.addressLine1);
  const unit = firstValue(address.unit, address.addressLine2, location.addressLine2);
  const city = firstValue(address.city, location.city);
  const state = firstValue(address.state, address.stateCode, location.state);
  const zip = firstValue(address.zip, address.zipCode, address.postalCode, location.zip);
  const locality = [city, state].filter(Boolean).join(', ');
  return [street, unit, locality, zip].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

export function buildJobChoices({ appointments = [], jobs = [], customers = [], locations = [] }) {
  const jobById = new Map(jobs.map((item) => [String(item.id), item]));
  const customerById = new Map(customers.map((item) => [String(item.id), item]));
  const locationById = new Map(locations.map((item) => [String(item.id), item]));

  return appointments
    .filter((appointment) => String(appointment.status || '').toLowerCase() !== 'canceled')
    .map((appointment) => {
      const linkedJob = jobById.get(String(appointment.jobId)) || appointment.job || {};
      const serviceTitanId = firstValue(linkedJob.id, appointment.jobId);
      if (!serviceTitanId) return null;
      const customer = customerById.get(String(linkedJob.customerId)) || linkedJob.customer || {};
      const location = locationById.get(String(linkedJob.locationId)) || linkedJob.location || {};
      const start = firstValue(appointment.start, appointment.arrivalWindowStart, linkedJob.start);
      const customerName = firstValue(customer.name, linkedJob.customerName, location.name, `Customer #${linkedJob.customerId || 'unknown'}`);
      const address = firstValue(formatAddress(location, linkedJob), location.name, linkedJob.locationName, `Location #${linkedJob.locationId || 'unknown'}`);
      const jobNumber = String(firstValue(linkedJob.jobNumber, linkedJob.number, serviceTitanId));

      const summary = String(firstValue(linkedJob.summary, linkedJob.jobTypeName) || '')
        .replace(/<br\s*\/?\s*>/gi, ' ')
        .replace(/<\/div>/gi, ' ')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/\s+/g, ' ')
        .trim();

      return {
        id: jobNumber,
        serviceTitanId: String(serviceTitanId),
        appointmentId: String(appointment.id || ''),
        appointmentNumber: String(appointment.appointmentNumber || ''),
        start: start || '',
        end: firstValue(appointment.end, appointment.arrivalWindowEnd, '') || '',
        time: formatAppointmentTime(start),
        customer: String(customerName),
        address: String(address),
        status: String(firstValue(appointment.status, linkedJob.jobStatus, 'Scheduled')),
        summary: summary.length > 140 ? `${summary.slice(0, 137).trim()}…` : summary,
        customerId: linkedJob.customerId ? String(linkedJob.customerId) : '',
        locationId: linkedJob.locationId ? String(linkedJob.locationId) : '',
      };
    })
    .filter(Boolean)
    .sort((a, b) => String(a.start).localeCompare(String(b.start)) || a.id.localeCompare(b.id));
}

function formatAppointmentTime(value) {
  if (!value) return 'Time not set';
  const text = String(value);
  const wallTime = text.match(/T(\d{2}):(\d{2})/);
  const hasExplicitZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text);
  if (wallTime && !hasExplicitZone) {
    const hour = Number(wallTime[1]);
    return `${hour % 12 || 12}:${wallTime[2]} ${hour >= 12 ? 'PM' : 'AM'}`;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    if (!wallTime) return 'Time not set';
    const hour = Number(wallTime[1]);
    return `${hour % 12 || 12}:${wallTime[2]} ${hour >= 12 ? 'PM' : 'AM'}`;
  }
  return new Intl.DateTimeFormat('en-US', {
    timeZone: DISPLAY_TIME_ZONE,
    hour: 'numeric',
    minute: '2-digit',
  }).format(parsed);
}
