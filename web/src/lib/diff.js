// @ts-check
// Word-level diff (longest common subsequence) for showing a proposal against the original text.

/** @typedef {{ type: 'same' | 'del' | 'ins', text: string }} DiffPart */

/** Words with the whitespace/punctuation that follows them, so that joining parts restores the text. */
const split = (/** @type {string} */ s) => s.match(/\S+\s*|\s+/g) ?? [];

/**
 * @param {string} before @param {string} after
 * @returns {DiffPart[]}
 */
export function wordDiff(before, after) {
  const a = split(before);
  const b = split(after);
  const n = a.length;
  const m = b.length;
  // dp[i][j] = LCS length of a[i:] and b[j:], compared without trailing spaces
  const key = (/** @type {string} */ w) => w.trim().toLowerCase();
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = key(a[i]) === key(b[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  /** @type {DiffPart[]} */
  const out = [];
  const push = (/** @type {DiffPart['type']} */ type, /** @type {string} */ text) => {
    const last = out.at(-1);
    if (last && last.type === type) last.text += text;
    else out.push({ type, text });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (key(a[i]) === key(b[j])) {
      push('same', b[j]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push('del', a[i++]);
    } else {
      push('ins', b[j++]);
    }
  }
  while (i < n) push('del', a[i++]);
  while (j < m) push('ins', b[j++]);
  return out;
}
