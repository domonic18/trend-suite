/** localStorage 键单一真相（此前 'wb.theme' ×4、'wb.ws.tab.production' ×2 散写）。 */
export const storageKeys = {
  theme: 'wb.theme',
  workspaceTab: (phase: 'plan' | 'production') => `wb.ws.tab.${phase}`,
} as const
