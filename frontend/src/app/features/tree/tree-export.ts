/** Turns the exported tree SVG into downloadable SVG, PNG or PDF files, entirely in the browser. */
import { t } from '../../core/i18n/i18n';

const MAX_CANVAS = 16_000;

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadSvg(svg: string, filename: string): void {
  download(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), filename);
}

async function rasterise(svg: string, width: number, height: number, scale: number): Promise<HTMLCanvasElement> {
  const s = Math.min(scale, MAX_CANVAS / width, MAX_CANVAS / height);
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error(t('Could not render the tree image')));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * s);
    canvas.height = Math.round(height * s);
    const ctx = canvas.getContext('2d')!;
    ctx.scale(s, s);
    ctx.drawImage(img, 0, 0, width, height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function downloadPng(svg: string, width: number, height: number, filename: string): Promise<void> {
  const canvas = await rasterise(svg, width, height, 2);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
  if (!blob) throw new Error(t('Could not create the PNG file'));
  download(blob, filename);
}

/** Longest side of the image placed in the PDF: about 300 dpi across an A3 page. */
const PDF_IMAGE_MAX = 4900;

export async function downloadPdf(svg: string, width: number, height: number, filename: string, title: string): Promise<void> {
  // Print resolution is enough; larger images only make the file huge.
  const scale = Math.min(2, PDF_IMAGE_MAX / Math.max(width, height));
  const canvas = await rasterise(svg, width, height, scale);
  const { jsPDF } = await import('jspdf');
  const landscape = width >= height;
  const pdf = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'pt', format: 'a3', compress: true });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 36;
  pdf.setFontSize(14);
  pdf.text(title, margin, margin);
  const k = Math.min((pageW - margin * 2) / width, (pageH - margin * 2 - 20) / height);
  pdf.addImage(canvas.toDataURL('image/jpeg', 0.9), 'JPEG', margin, margin + 16, width * k, height * k, undefined, 'FAST');
  pdf.save(filename);
}
