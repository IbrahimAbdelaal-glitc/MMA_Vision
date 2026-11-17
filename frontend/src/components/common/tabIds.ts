import type { DashboardView } from '../../types/dashboard'

/** Element ids that link each state tab to the panel it controls. */
export const tabId = (view: DashboardView) => `tab-${view}`
export const panelId = (view: DashboardView) => `panel-${view}`
