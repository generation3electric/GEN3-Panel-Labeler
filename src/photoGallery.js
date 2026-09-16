export function photoLabel(name = '') {
  const key = name.replace(/^\d+-/, '').replace(/\.[^.]+$/, '');
  const labels = { overview: 'Full Panel Overview', breakerField: 'Full Panel Overview', manufacturer: 'Manufacturer Label', directory: 'Existing Panel Directory' };
  if (labels[key]) return labels[key];
  const side = key.match(/^(left|right)-(\d+)$/);
  return side ? `${side[1] === 'left' ? 'Left' : 'Right'} Breakers ${side[2]}` : name;
}

// Only serve raster photos belonging to the selected panel folder.
export function isPanelPhoto(file) {
  return Boolean(file.file && (/^image\/(jpeg|png|webp|gif|heic|heif|avif|bmp|tiff)$/i.test(file.file.mimeType || '') ||
    /\.(jpe?g|png|webp|gif|heic|heif|avif|bmp|tiff?)$/i.test(file.name || '')));
}

export function panelPhotoList(files, itemId) {
  return files.filter(isPanelPhoto).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })).map((file) => ({
    id: file.id, name: file.name, label: photoLabel(file.name),
    url: `/api/sharepoint/panel-records/${encodeURIComponent(itemId)}/photos/${encodeURIComponent(file.id)}`,
  }));
}
