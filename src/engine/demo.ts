// A demo project with generated artwork, to try the whole flow (editor, PDF,
// print, cut) without hunting for images.
import { fitBox } from '../core/layout';
import { makeFillLayer, makeImageLayer, makePiece, makeProject, makeShapeLayer, makeTextLayer, type Piece, type Project } from '../core/model';
import { buildDieline } from '../core/templates/catalog';
import { importImage, type AssetInfo } from './assets';
import { saveProject } from './persistence';
import { renderThumbnail } from './render/preview';

function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
}

async function generateArt(w: number, h: number, seed: number, hues: [number, number]): Promise<Blob> {
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d')!;
  const rnd = rng(seed);
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, `hsl(${hues[0]},65%,22%)`);
  g.addColorStop(1, `hsl(${hues[1]},70%,55%)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'screen';
  for (let i = 0; i < 70; i++) {
    const r = (0.03 + rnd() * 0.18) * Math.min(w, h);
    const x = rnd() * w, y = rnd() * h;
    const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
    const hue = hues[0] + rnd() * (hues[1] - hues[0]);
    rg.addColorStop(0, `hsla(${hue},90%,70%,${0.25 + rnd() * 0.4})`);
    rg.addColorStop(1, `hsla(${hue},90%,50%,0)`);
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = Math.max(2, w / 600);
  for (let i = 0; i < 24; i++) {
    ctx.beginPath();
    const y0 = rnd() * h;
    ctx.moveTo(0, y0);
    for (let x = 0; x <= w; x += w / 40) ctx.lineTo(x, y0 + Math.sin(x / (w / 6) + i) * h * 0.04);
    ctx.stroke();
  }
  return c.convertToBlob({ type: 'image/jpeg', quality: 0.93 });
}

const coverPanel = (piece: Piece, asset: AssetInfo, panelId: string, bleed: number) => {
  const d = buildDieline(piece.templateId, piece.params);
  const panel = d.panels.find((p) => p.id === panelId)!;
  const layer = makeImageLayer(asset.id, asset.name, asset.width, asset.height, fitBox(panel, 'cover-bleed', asset.width / asset.height, bleed));
  layer.clip = { panelId };
  return layer;
};

export interface DemoText { title: string; artist: string; tracks: string; spine: string; background: string; rect: string }

export async function createDemoProject(name: string, text: DemoText): Promise<Project> {
  const square = await importImage(await generateArt(2400, 2400, 7, [250, 330]), 'demo-cover.jpg');
  const wide = await importImage(await generateArt(3600, 2400, 11, [190, 260]), 'demo-back.jpg');
  const bleed = 3;

  const booklet = makePiece('jewel.booklet4');
  booklet.layers.outside.push(coverPanel(booklet, square, 'front', bleed));
  booklet.layers.outside.push(coverPanel(booklet, wide, 'back', bleed));
  booklet.layers.outside.push(makeTextLayer(text.title, { x: 128, y: 14, w: 104, h: 12 }, { fontFamily: 'Bebas Neue', fontSize: 34, color: '#ffffff', align: 'center' }));
  booklet.layers.outside.push(makeTextLayer(text.artist, { x: 128, y: 98, w: 104, h: 8 }, { fontFamily: 'Oswald', fontSize: 14, color: '#ffffff', align: 'center', letterSpacing: 0.1 }));

  const tray = makePiece('jewel.tray');
  const trayD = buildDieline('jewel.tray', {});
  tray.layers.outside.push(makeFillLayer('#1d1b3a', { x: 0, y: 0, w: trayD.w, h: trayD.h }, text.background));
  tray.layers.outside.push(coverPanel(tray, wide, 'back', bleed));
  tray.layers.outside.push(makeShapeLayer('rect', { x: 20, y: 18, w: 111, h: 82 }));
  const panel = tray.layers.outside[tray.layers.outside.length - 1];
  if (panel.type === 'shape') Object.assign(panel, { name: text.rect, fill: 'rgba(0,0,0,0.45)', cornerRadius: 3 });
  tray.layers.outside.push(makeTextLayer(text.tracks, { x: 26, y: 24, w: 99, h: 30 }, { fontFamily: 'Inter', fontSize: 9, color: '#ffffff', lineHeight: 1.5, mode: 'tracklist' }));
  for (const [spineId, x] of [['spineL', 0], ['spineR', trayD.w - 6.5]] as const) {
    const sp = makeTextLayer(text.spine, { x: x + 3.25 - 50, y: 59 - 2.5, w: 100, h: 5 }, { fontFamily: 'Oswald', fontSize: 9, fontWeight: 700, color: '#ffffff', align: 'center' });
    sp.rotation = 90;
    sp.clip = { panelId: spineId };
    tray.layers.outside.push(sp);
  }

  const disc = makePiece('disc.label');
  disc.layers.outside.push(coverPanel(disc, square, 'disc', bleed));
  disc.layers.outside.push(makeTextLayer(text.title, { x: 18.5, y: 20, w: 80, h: 10 }, { fontFamily: 'Bebas Neue', fontSize: 22, color: '#ffffff', align: 'center' }));

  const project = makeProject(name, 'jewel', [booklet, tray, disc]);
  project.assetIds = [square.id, wide.id];
  await saveProject(project, (await renderThumbnail(project)) ?? undefined);
  return project;
}
