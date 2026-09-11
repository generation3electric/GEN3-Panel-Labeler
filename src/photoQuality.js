// Lightweight screening, not OCR or a guarantee of legibility. Works without a network.
export function assessPixels({ data, width, height }, originalWidth = width, originalHeight = height) {
  const gray = new Float32Array(width * height);
  let sum = 0, squared = 0, bright = 0, dark = 0;
  for (let i = 0; i < gray.length; i++) {
    const value = .299 * data[i * 4] + .587 * data[i * 4 + 1] + .114 * data[i * 4 + 2];
    gray[i] = value; sum += value; squared += value * value;
    if (value > 248) bright++;
    if (value < 35) dark++;
  }
  let lapSum = 0, lapSquared = 0, samples = 0;
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const i = y * width + x;
    const lap = gray[i - 1] + gray[i + 1] + gray[i - width] + gray[i + width] - 4 * gray[i];
    lapSum += lap; lapSquared += lap * lap; samples++;
  }
  const mean = sum / gray.length;
  const contrast = Math.sqrt(Math.max(0, squared / gray.length - mean * mean));
  const sharpness = samples ? lapSquared / samples - (lapSum / samples) ** 2 : 0;
  const issues = [];
  if (Math.min(originalWidth, originalHeight) < 600) issues.push('Low resolution: move closer and retake so small markings can be read.');
  if (sharpness < 75) issues.push('Possible blur: steady the phone, tap to focus, and retake.');
  if (bright / gray.length > .12) issues.push('Possible glare / overexposure: change the angle or turn off the flash.');
  if (mean < 55 || dark / gray.length > .65) issues.push('Too dark: add light without reflecting it into the camera.');
  if (contrast < 25) issues.push('Low contrast: check that the lettering stands out and is readable.');
  return { status: 'checked', method: 'local-image-screen-v1', issues, width: originalWidth, height: originalHeight,
    metrics: { sharpness: Math.round(sharpness), brightness: Math.round(mean), contrast: Math.round(contrast), brightFraction: bright / gray.length },
    checkedAt: new Date().toISOString(), accepted: false, reason: '' };
}

export async function checkPhoto(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Image decode timed out')), 15000);
      img.onload = () => { clearTimeout(timer); resolve(); };
      img.onerror = () => { clearTimeout(timer); reject(new Error('Image could not be opened')); };
      img.src = url;
    });
    const scale = Math.min(1, 640 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(img, 0, 0, canvas.width, canvas.height);
    return assessPixels(context.getImageData(0, 0, canvas.width, canvas.height), img.naturalWidth, img.naturalHeight);
  } catch {
    return { status: 'unavailable', method: 'local-image-screen-v1', issues: ['This image could not be checked. Retake as JPEG/PNG, or keep the original with a reason for review.'], accepted: false, reason: '' };
  } finally { URL.revokeObjectURL(url); }
}
