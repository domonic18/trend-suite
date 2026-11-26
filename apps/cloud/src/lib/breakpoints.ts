/**
 * 布局常量单一真相：JS 侧（matchMedia）与 CSS 侧（@media）共用的断点。
 * CSS 侧（chat.css 的 @media）改值时必须同步这里——两源互指，防止漂移
 * （评审教训：同一真相两个来源，改一处漏一处 = 窄屏形态错乱）。
 */

/** 工作台双栏 → 单栏堆叠的断点。 */
export const NARROW_QUERY = '(max-width: 1280px)'
