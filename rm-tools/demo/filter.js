/* Client search for the demo: rows come from recorded one-character fragments and are
   narrowed in the browser. Shared by sw.js and by build.mjs's self-check. */
self.demoSearch = function demoSearch(data, rawQuery) {
  const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const q = norm(rawQuery.trim());
  const fragment = (n, rows) => '\n  <div class="search-rows" role="list">' + rows.join('') + '</div>\n  <p class="muted table-note">'
    + n + (n === 1 ? ' resultado.' : ' resultados.') + '</p>\n';
  if (!q) return '';
  const source = data.search[q[0]] || '';
  const rows = source.match(/<div class="search-row"[\s\S]*?<\/button>\s*<\/div>/g) || [];
  const keep = rows.filter((row) => {
    const code = (row.match(/search-row-id mono">([^<]+)</) || [])[1] || '';
    const name = norm((row.match(/search-row-name">([^<]+)</) || [])[1] || '');
    return code.includes(q) || name.includes(q);
  });
  if (!keep.length) {
    const shown = rawQuery.trim().replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    return data.emptyFrag.replace('{q}', shown);
  }
  return fragment(keep.length, keep);
};
