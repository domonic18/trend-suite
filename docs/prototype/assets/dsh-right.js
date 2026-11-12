/* ============================================================
   dsh 框架交互（学员端共享行为 · R31/R32）
   1. 右栏页签：.right 内 .rtab[data-pane] 点击切换 .rpane[data-pane]
   2. 中央视图页签：.main 内 .vtab[data-view] 点击切换 .viewpane[data-view]
   3. 侧栏折叠：.tgl 点击切换 .dsh-row 的 sb-hide（DSH sidebar toggle）
   4. 右栏开合：[data-action=toggle-right] 切换 .dsh-row 的 has-right
   5. 底部终端收起：.bt-close 隐藏 .dsh-bottom；[data-action=toggle-bottom] 恢复
   页签是页内动作用 <button>；跨页导航不经过此脚本。
   ============================================================ */
(function () {
  'use strict';

  function pick(root, sel) { return Array.prototype.slice.call(root.querySelectorAll(sel)); }

  /* 1. 右栏页签 */
  pick(document, '.right').forEach(function (right) {
    var tabs = pick(right, '.rtab'), panes = pick(right, '.rpane');
    if (!tabs.length || !panes.length) return;
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        var key = tab.getAttribute('data-pane');
        tabs.forEach(function (t) { t.classList.toggle('on', t === tab); });
        panes.forEach(function (p) { p.classList.toggle('on', p.getAttribute('data-pane') === key); });
      });
    });
  });

  /* 2. 中央视图页签（对话/轨迹/用量）*/
  pick(document, '.main').forEach(function (main) {
    var tabs = pick(main, '.vtab'), panes = pick(main, '.viewpane');
    if (!tabs.length || !panes.length) return;
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        var key = tab.getAttribute('data-view');
        tabs.forEach(function (t) { t.classList.toggle('on', t === tab); });
        panes.forEach(function (p) { p.classList.toggle('on', p.getAttribute('data-view') === key); });
        var sc = main.querySelector('.scroll');
        if (sc) sc.scrollTop = 0;
      });
    });
  });

  /* 3. 侧栏折叠 */
  pick(document, '.tgl').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var row = btn.closest('.dsh-row');
      if (row) row.classList.toggle('sb-hide');
    });
  });

  /* 4. 右栏开合 */
  pick(document, '[data-action="toggle-right"]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var row = btn.closest('.dsh-row');
      if (row) row.classList.toggle('has-right');
    });
  });

  /* 5. 底部终端收起 / 恢复 */
  pick(document, '.bt-close').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var bar = btn.closest('.dsh-bottom');
      if (bar) bar.classList.add('hide');
    });
  });
  pick(document, '[data-action="toggle-bottom"]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var frame = btn.closest('.dsh');
      var bar = frame ? frame.querySelector('.dsh-bottom') : null;
      if (bar) bar.classList.toggle('hide');
    });
  });
})();
