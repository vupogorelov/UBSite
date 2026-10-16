// @ts-check
// The drawers opened over everything (the account, the workspaces, administration), in one list: the
// shell (Shell.svelte) shows the open one, loading its component when first opened; each is given
// `onclose`. A new drawer = an item here (and a way to open it: the menu, «Ещё»).
// (The settings are a drawer of their own kind: always there, opened and closed — Shell.svelte.)

/** @typedef {{ id: 'workspaces' | 'admin' | 'account', load: () => Promise<{ default: any }> }} DrawerEntry */

/** @type {DrawerEntry[]} */
export const DRAWERS = [
  { id: 'workspaces', load: () => import('../components/WorkspacesPanel.svelte') },
  { id: 'admin', load: () => import('../components/AdminPanel.svelte') },
  { id: 'account', load: () => import('../components/AccountPanel.svelte') },
];

/** What can be open: none, the settings, or a drawer of the list. @typedef {'none' | 'settings' | DrawerEntry['id']} Drawer */
