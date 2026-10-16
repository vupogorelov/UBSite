// @ts-check
// «Поддержать проект» (the page: web/src/features/support/): the YooMoney fundraising widget is a page of
// that site shown inside ours — the security policy lets it in.

/** @type {import('../core.js').Feature} */
export default {
  name: 'support',
  setup(core) {
    core.allowFrame('https://yoomoney.ru');
  },
};
