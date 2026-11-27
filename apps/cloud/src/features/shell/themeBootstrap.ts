/**
 * 主题防闪白脚本（arch/08 §6）：工作台默认深色，读取本地偏好写 <html> 的
 * data-wb-theme。**必须由服务端组件渲染进 SSR HTML**——浏览器不执行
 * innerHTML 注入的 <script>（client component 里用 dangerouslySetInnerHTML
 * 写脚本不会跑），那样首帧会用 :root 浅色闪一下。
 */
export const THEME_BOOTSTRAP = `(() => {
  try {
    var saved = localStorage.getItem('wb.theme') /* = storageKeys.theme（脚本是字符串，无法 import；改名须同步） */;
    document.documentElement.setAttribute('data-wb-theme', saved === 'light' ? 'light' : 'dark');
  } catch (e) {
    document.documentElement.setAttribute('data-wb-theme', 'dark');
  }
})();`
