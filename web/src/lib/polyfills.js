// @ts-check
// What older engines lack. The Android app runs in the phone's WebView, which is not always updated
// with the browser (a Huawei phone had Chrome 114 there while its Chrome was 151).

// Map.groupBy — Chrome 117, Safari 17.4
if (!Map.groupBy) {
  /** @type {any} */ (Map).groupBy = (/** @type {Iterable<any>} */ items, /** @type {(x: any, i: number) => any} */ key) => {
    const out = new Map();
    let i = 0;
    for (const x of items) {
      const k = key(x, i++);
      const list = out.get(k);
      if (list) list.push(x);
      else out.set(k, [x]);
    }
    return out;
  };
}
