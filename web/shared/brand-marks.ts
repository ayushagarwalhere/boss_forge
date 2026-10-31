// Platform marks, drawn inline (no downloaded files). They only show which
// platforms Boss Forge targets; the names and logos belong to their owners.

/** Twitch "Glitch" outline, 24x24 viewBox. */
export const TWITCH_GLITCH_PATH =
  'M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z';

export const TWITCH_PURPLE = '#9146FF';

/** Codex as a terminal prompt (">_") inside a rounded tile, 24x24 viewBox. */
export const CODEX_MARK_SVG =
  '<rect x="1.5" y="1.5" width="21" height="21" rx="6" fill="none" stroke="currentColor" stroke-width="2"/>' +
  '<path d="M7 8.2l4 3.8-4 3.8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>' +
  '<path d="M12.8 16.2h4.4" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>';

export function twitchSvg(className = 'mark'): string {
  return `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="${TWITCH_GLITCH_PATH}"/></svg>`;
}

export function codexSvg(className = 'mark'): string {
  return `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${CODEX_MARK_SVG}</svg>`;
}
