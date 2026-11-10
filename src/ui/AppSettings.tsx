import { useState } from 'react';
import { currentLang, LANGS, setLang, type Lang } from '../i18n';
import { GitHubMark, Icon, IconButton, Segmented, type IconName } from './components';
import { useT } from './hooks';
import { setThemePref, THEME_PREFS, useThemePref, type ThemePref } from './theme';

export function LanguageSwitch() {
  const t = useT();
  return (
    <div className="flex items-center gap-2" title={t('app.language')}>
      <Icon name="globe" className="text-muted" />
      <Segmented<Lang> value={currentLang()} onChange={setLang} ariaLabel={t('app.language')}
        options={LANGS.map((l) => ({ value: l, label: l.toUpperCase() }))} />
    </div>
  );
}

export const REPO_URL = 'https://github.com/R0adRunn3r/coverfold';
const ISSUES_URL = `${REPO_URL}/issues/new/choose`;
const DONATE_URL = 'https://ko-fi.com/r0adrunn3r';

/** Source code, bug reports, donations and version: in the home footer and the editor settings. */
export function AppLinks({ className = '' }: { className?: string }) {
  const t = useT();
  const link = 'inline-flex items-center gap-1.5 hover:text-ink';
  return (
    <div className={`text-xs text-muted ${className}`} data-testid="app-links">
      <a className={link} href={REPO_URL} target="_blank" rel="noreferrer" title={t('app.githubHint')}><GitHubMark size={14} />GitHub</a>
      <a className={link} href={ISSUES_URL} target="_blank" rel="noreferrer">{t('app.feedback')}</a>
      <a className={link} href={DONATE_URL} target="_blank" rel="noreferrer" title={t('app.donateHint')}><Icon name="coffee" size={14} />{t('app.donate')}</a>
      <span>Coverfold {__APP_VERSION__}</span>
    </div>
  );
}

const THEME_ICON: Record<ThemePref, IconName> = { system: 'monitor', light: 'sun', dark: 'moon' };

export function ThemeSwitch() {
  const t = useT();
  const pref = useThemePref();
  return (
    <Segmented<ThemePref> value={pref} onChange={setThemePref} ariaLabel={t('app.theme')}
      options={THEME_PREFS.map((p) => ({ value: p, title: t(`app.theme_${p}`), label: <Icon name={THEME_ICON[p]} size={14} /> }))} />
  );
}

/**
 * Language and theme, shown together in every top bar. `compact` folds them
 * into a settings button, for the crowded editor toolbar.
 */
export function AppSettings({ compact = false }: { compact?: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  if (!compact) {
    return (
      <div className="flex items-center gap-2" data-testid="app-settings">
        <LanguageSwitch />
        <ThemeSwitch />
      </div>
    );
  }
  return (
    <div className="relative" data-testid="app-settings">
      <IconButton icon="settings" label={t('app.settings')} active={open} onClick={() => setOpen(!open)} />
      {open && <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} aria-hidden="true" />}
      {open && (
        <div className="absolute right-0 top-full z-40 mt-1 w-56 space-y-3 rounded-lg border border-line bg-panel p-3 shadow-lg">
          <div className="space-y-1"><div className="label">{t('app.language')}</div><LanguageSwitch /></div>
          <div className="space-y-1"><div className="label">{t('app.theme')}</div><ThemeSwitch /></div>
          <AppLinks className="flex flex-col gap-1.5 border-t border-line pt-3" />
        </div>
      )}
    </div>
  );
}
