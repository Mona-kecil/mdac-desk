import { parseMRZ } from './mrz.js';
export async function readPassport(file, onProgress = () => {}) {
  if (!file || file.size > 12*1024*1024) throw new Error('Foto paspor maksimal 12 MB.');
  if (!['image/jpeg','image/png','image/webp'].includes(file.type)) throw new Error('Gunakan gambar JPG, PNG, atau WebP.');
  const { createWorker } = await import('tesseract.js');
  const base = new URL('/ocr/',location.origin).href;
  const worker = await createWorker('eng',1,{workerPath:base+'worker.min.js',corePath:base,langPath:base,workerBlobURL:false,logger:message=>onProgress(message.progress || 0)});
  try {
    await worker.setParameters({tessedit_char_whitelist:'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<',preserve_interword_spaces:'1'});
    const {data} = await worker.recognize(file);
    return {...parseMRZ(data.text),text:data.text,confidence:data.confidence};
  } finally {await worker.terminate();}
}
