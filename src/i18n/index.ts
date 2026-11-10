import i18next from 'i18next';
import type { PrintStrings } from '../core/printPlan';
import { ALL_ASSEMBLY_KEYS, TEMPLATES } from '../core/templates/catalog';
import en from './en.json';
import it from './it.json';

export type Lang = 'it' | 'en';
export const LANGS: Lang[] = ['it', 'en'];
const STORAGE_KEY = 'coverfold.lang';

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'it' || saved === 'en') return saved;
  } catch {
    // storage unavailable (private mode): fall back to the browser language
  }
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('it') ? 'it' : 'en';
}

export const i18n = i18next.createInstance();
void i18n.init({
  resources: { it: { translation: it }, en: { translation: en } },
  lng: initialLang(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  initAsync: false,
});

export const t = (key: string, opts: Record<string, unknown> = {}): string => i18n.t(key, opts) as string;

export function setLang(lang: Lang): void {
  void i18n.changeLanguage(lang);
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // storage blocked: the choice lasts for this page only
  }
}

export const currentLang = (): Lang => (i18n.language === 'it' ? 'it' : 'en');

/** Plain strings for the PDF (the export worker has no i18n instance). */
export function printStrings(): PrintStrings {
  return {
    sheetLabel: t('print.sheetLabel'),
    front: t('print.front'),
    back: t('print.back'),
    paper: { paper: t('paper.paper'), cardstock: t('paper.cardstock'), sticker: t('paper.sticker') },
    pieceName: Object.fromEntries(TEMPLATES.map((tp) => [tp.id, t(tp.nameKey)])),
    assembly: Object.fromEntries(ALL_ASSEMBLY_KEYS.map((k) => [k, t(k)])),
    instructionsTitle: t('print.instructionsTitle'),
    sheetsHeading: t('print.sheetsHeading'),
    sheetLine: t('print.sheetLine'),
    generalHeading: t('print.generalHeading'),
    general: [t('print.general1'), t('print.general2'), t('print.general3'), t('print.general4')],
    rulerCaption: t('print.rulerCaption'),
    rulerCaptionShort: t('print.rulerCaptionShort'),
    partName: t('print.partName'),
    joinHeading: t('print.joinHeading'),
    joinSteps: [t('print.join1'), t('print.join2'), t('print.join3'), t('print.join4')],
  };
}
