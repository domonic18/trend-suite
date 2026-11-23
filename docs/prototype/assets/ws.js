/* 右栏工作区共享脚本（chat-center 布局）：页签切换 + 拖拽调宽。
   页签：.ws 内 .ctabs button[data-pane] ↔ .ctpane#id；
   拖宽：.ws-drag 把手改 .ops-app.chat-center 的第三列宽（340–680px）。 */
(function () {
  document.querySelectorAll('.ws .ctabs button').forEach(function (b) {
    b.addEventListener('click', function () {
      b.closest('.ctabs').querySelectorAll('button').forEach(function (o) { o.classList.toggle('on', o === b); });
      var ws = b.closest('.ws');
      ws.querySelectorAll('.ctpane').forEach(function (p) { p.classList.toggle('on', p.id === b.dataset.pane); });
    });
  });
  /* 次级页签（.stabs ↔ .spane）：只在所在 .ctpane 内切换，不影响工作区一级页签 */
  document.querySelectorAll('.ws .stabs').forEach(function (tabs) {
    tabs.querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () {
        tabs.querySelectorAll('button').forEach(function (o) { o.classList.toggle('on', o === b); });
        tabs.parentElement.querySelectorAll(':scope > .spane').forEach(function (p) { p.classList.toggle('on', p.id === b.dataset.pane); });
      });
    });
  });

  var app = document.querySelector('.ops-app.chat-center');
  var handle = document.querySelector('.ws-drag');
  if (!app || !handle) return;
  var MIN = 340, MAX = 680, NAV = 224;
  function startW() {
    var cols = getComputedStyle(app).gridTemplateColumns.split(' ');
    var w = parseFloat(cols[cols.length - 1]);
    return isNaN(w) ? 432 : w;
  }
  handle.addEventListener('mousedown', function (e) {
    e.preventDefault();
    handle.classList.add('active');
    var w0 = startW(), x0 = e.clientX;
    function move(ev) {
      var w = Math.max(MIN, Math.min(MAX, w0 + (x0 - ev.clientX)));
      app.style.gridTemplateColumns = NAV + 'px minmax(0, 1fr) ' + w + 'px';
    }
    function up() {
      handle.classList.remove('active');
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    }
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
})();
