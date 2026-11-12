/* 课程切换器（.sb-course[data-sb-course]）：按钮 + 锚定浮层。
   交互对齐 Notion / Linear 的 workspace switcher：
   - 点按钮开合浮层（aria-expanded 同步），↓/↑ 在课程间移动焦点
   - 选中一项即切换：更新按钮上的状态点、课程名、进度摘要，并关闭
   - Esc、点击浮层外部、滚动/改尺寸时关闭（浮层为固定定位，需跟随按钮重算位置）
   浮层用 position:fixed 以免被侧栏的 overflow 裁剪。 */
(function () {
  var open = null;

  function parts(w) {
    return {
      btn: w.querySelector('.sbc-btn'),
      pop: w.querySelector('.sbc-pop'),
      t: w.querySelector('.sbc-btn .sbc-t')
    };
  }

  function place(w) {
    var p = parts(w), r = p.btn.getBoundingClientRect();
    var width = Math.max(Math.round(r.width) + 36, 236);
    p.pop.style.width = width + 'px';
    p.pop.style.left = Math.round(r.left) + 'px';
    p.pop.style.top = Math.round(r.bottom + 6) + 'px';
    var h = p.pop.offsetHeight;
    if (r.bottom + 6 + h > window.innerHeight - 8) {
      p.pop.style.top = Math.max(8, Math.round(r.top - 6 - h)) + 'px';
    }
  }

  function close(w) {
    var p = parts(w);
    p.pop.classList.remove('open');
    p.btn.setAttribute('aria-expanded', 'false');
    if (open === w) open = null;
  }

  function show(w) {
    if (open && open !== w) close(open);
    var p = parts(w);
    p.pop.classList.add('open');
    p.btn.setAttribute('aria-expanded', 'true');
    place(w);
    open = w;
  }

  function select(w, item) {
    parts(w).pop.querySelectorAll('.sbc-i').forEach(function (el) {
      var on = el === item;
      el.classList.toggle('on', on);
      el.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    var btnDot = parts(w).btn.querySelector('.sbc-t').previousElementSibling;
    btnDot.className = item.dataset.dot || 'dot-run';
    parts(w).t.innerHTML = '<b>' + item.dataset.name + '</b><small>' + item.dataset.meta + '</small>';
    close(w);
    parts(w).btn.focus();
  }

  document.querySelectorAll('[data-sb-course]').forEach(function (w) {
    var p = parts(w);

    p.btn.addEventListener('click', function () {
      if (open === w) close(w); else show(w);
    });

    p.pop.querySelectorAll('.sbc-i').forEach(function (item) {
      item.addEventListener('click', function () { select(w, item); });
    });

    p.btn.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        show(w);
        var items = Array.prototype.slice.call(p.pop.querySelectorAll('.sbc-i'));
        var cur = items.indexOf(document.activeElement);
        var next = e.key === 'ArrowDown'
          ? (cur + 1) % items.length
          : (cur <= 0 ? items.length - 1 : cur - 1);
        items[next].focus();
      }
    });
  });

  document.addEventListener('click', function (e) {
    if (open && !open.contains(e.target)) close(open);
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && open) { var w = open; close(w); parts(w).btn.focus(); }
  });

  window.addEventListener('resize', function () { if (open) place(open); });
  window.addEventListener('scroll', function () { if (open) place(open); }, true);
})();
