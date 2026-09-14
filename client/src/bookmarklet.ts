// Readable bookmarklet source (SPEC §8) — same-origin popup, deliberately not
// a cross-origin fetch(), so it works with zero CORS handling and relies on
// whatever already gates the Savit origin. buildBookmarkletHref() bakes the
// real Savit origin into a `javascript:` URL and strips whitespace at render
// time — generated fresh from this source, not hand-minified.
export function bookmarkletSource(savitOrigin: string): string {
  return `
    var img = (document.querySelector('meta[property="og:image"]') || {}).content
      || (document.querySelector('meta[name="twitter:image"]') || {}).content || '';
    window.open(${JSON.stringify(savitOrigin)} + '/save'
      + '?url=' + encodeURIComponent(location.href)
      + '&title=' + encodeURIComponent(document.title)
      + '&image=' + encodeURIComponent(img),
      'savit-save', 'width=420,height=560');
  `;
}

export function buildBookmarkletHref(savitOrigin: string): string {
  const minified = bookmarkletSource(savitOrigin).replace(/\s+/g, ' ').trim();
  return `javascript:(function(){${minified}})();`;
}
