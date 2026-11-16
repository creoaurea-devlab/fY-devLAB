export type PreviewPreferences = {
  ratio: number;
  view: string;
  viewport: 'fit' | 'desktop' | 'mobile';
  collapsed: boolean;
};
export const defaultPreferences: PreviewPreferences = {
  ratio: 50,
  view: '',
  viewport: 'fit',
  collapsed: false,
};
export function normalizePreferences(raw: unknown): PreviewPreferences {
  const value =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    collapsed: value.collapsed === true,
    ratio:
      typeof value.ratio === 'number' && Number.isFinite(value.ratio)
        ? Math.max(25, Math.min(75, value.ratio))
        : 50,
    view:
      typeof value.view === 'string' &&
      /^[a-z][a-z0-9-]{0,63}$/.test(value.view)
        ? value.view
        : '',
    viewport:
      value.viewport === 'desktop' || value.viewport === 'mobile'
        ? value.viewport
        : 'fit',
  };
}
export function loadPreferences(projectId: string): PreviewPreferences {
  try {
    return normalizePreferences(
      JSON.parse(localStorage.getItem('devlab.preview.' + projectId) ?? 'null'),
    );
  } catch {
    return { ...defaultPreferences };
  }
}
export function savePreferences(
  projectId: string,
  value: PreviewPreferences,
): void {
  try {
    localStorage.setItem(
      'devlab.preview.' + projectId,
      JSON.stringify(normalizePreferences(value)),
    );
  } catch {
    /* Storage may be disabled; in-memory controls remain usable. */
  }
}
/** URL validation is retained here even though server payloads are validated upstream. */
export function previewURL(
  base: string | undefined,
  path = '/',
  theme?: 'light' | 'dark',
): string | null {
  if (!base) return null;
  try {
    const origin = new URL(base),
      url = new URL(path, origin);
    if (theme) url.searchParams.set('theme', theme);
    return origin.protocol === 'http:' &&
      ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname) &&
      !origin.username &&
      !origin.password &&
      url.origin === origin.origin &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
