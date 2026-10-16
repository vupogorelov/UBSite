// @ts-check
// Comment text → safe HTML: **bold**, *italic*, paragraph refs (2:5.10) as links, #tags, @mentions,
// line breaks.

/** @param {string} s */
const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** @param {string} text */
export function renderBody(text) {
  return escapeHtml(text)
    .replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*])\*(?=\S)([^*]+?)(?<=\S)\*(?!\*)/g, '$1<i>$2</i>')
    .replace(/(?<![\d:.])(\d{1,3}:\d{1,2}(?:\.\d{1,3})?)(?!\d)/g, '<a href="/$1" data-internal>$1</a>')
    .replace(/(^|[\s(])#([\p{L}\p{N}_/-]+)/gu, '$1<span class="tag">#$2</span>')
    .replace(/(^|[^\p{L}\p{N}_])@([\p{L}\p{N}_.-]{2,40})/gu, '$1<span class="tg-mention">@$2</span>')
    .replace(/\n/g, '<br>');
}
