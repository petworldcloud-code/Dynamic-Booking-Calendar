// Attachments are stored in Firestore (bookings/{id}/attachments/{attId}) because Firebase Storage
// needs a paid plan. A Firestore document is limited to 1 MiB, so each file is capped at
// MAX_BYTES (base64 inflates by ~33%). Photos are shrunk in the browser to fit.
export const MAX_FILES = 5;
export const MAX_BYTES = 600 * 1024;
export const ACCEPT = 'image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt';

const ALLOWED = [
  /^image\//, /^application\/pdf$/, /^text\/(plain|csv)$/,
  /^application\/msword$/, /^application\/vnd\.ms-excel$/,
  /^application\/vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet)$/
];
const EXT_TYPES = {
  pdf: 'application/pdf', doc: 'application/msword', xls: 'application/vnd.ms-excel', csv: 'text/csv', txt: 'text/plain',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
};

export const formatSize = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`);

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(new Error('Could not read the file.'));
    r.readAsDataURL(blob);
  });
}

async function shrinkImage(file) {
  const bmp = await createImageBitmap(file);
  let scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  for (let attempt = 0; attempt < 6; attempt++) {
    const w = Math.max(1, Math.round(bmp.width * scale)); const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    for (const q of [0.82, 0.7, 0.55]) {
      const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', q));
      if (blob && blob.size <= MAX_BYTES) return blob;
    }
    scale *= 0.75;
  }
  throw new Error('This image is too large to attach.');
}

/** Validate/shrink a picked File into {id,name,type,size,data} ready to store. */
export async function prepareFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  let type = file.type || EXT_TYPES[ext] || '';
  if (!ALLOWED.some((re) => re.test(type))) throw new Error(`"${file.name}": this file type is not allowed.`);
  let blob = file; let name = file.name;
  if (type.startsWith('image/') && (type !== 'image/jpeg' || file.size > MAX_BYTES)) {
    if (type === 'image/svg+xml') throw new Error(`"${file.name}": SVG images are not allowed.`);
    try { blob = await shrinkImage(file); type = 'image/jpeg'; name = name.replace(/\.[^.]+$/, '') + '.jpg'; }
    catch (e) { throw new Error(`"${file.name}": ${e.message}`); }
  }
  if (blob.size > MAX_BYTES) throw new Error(`"${file.name}" is ${formatSize(blob.size)}; the limit is ${formatSize(MAX_BYTES)}.`);
  return { id: crypto.randomUUID(), name: name.slice(0, 100), type, size: blob.size, data: await blobToBase64(blob) };
}

export function base64ToBlobUrl(data, type) {
  const bin = atob(data); const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type }));
}
