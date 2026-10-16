// @ts-check
// A guest: someone who came by a shared link to a paragraph or a quote without signing in. They read
// the linked paper (and on to the others); what takes an account — the discussions, the variants of
// translation, notes — asks them to sign in first, and brings them back to the same place after it.

export const guest = $state({
  /** The sign-in page rather than a guest's reading (the site itself, signed out, or asked for). */
  login: false,
  /** It was asked for from the reading: the page offers the way back to the text. */
  fromReading: false,
  /** What the guest reached for that takes signing in ('' — nothing asked). */
  ask: '',
});

/** @param {string} what e.g. «обсуждение» */
export function askLogin(what) {
  guest.ask = what;
}

export function openLogin() {
  guest.ask = '';
  guest.login = true;
  guest.fromReading = true;
}

/** From the sign-in page back to the text it was opened from. */
export function backToReading() {
  guest.login = false;
  guest.fromReading = false;
}
