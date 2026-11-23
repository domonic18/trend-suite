/* 大纲树 outliner：折叠 / 行内改名 / 上下移 / 增删 / 同级拖拽。
   编号口径：篇用中文数字、章号全书连续、课时号章内重排；空章自动标「证据不足」。
   页面只需提供 .ot 结构（lv-pian / lv-zhang / lv-ke 三层，平铺课时直接用 lv-ke）。 */
(function () {
  var CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

  function typeOf(it) {
    return it.classList.contains('lv-pian') ? 'pian' : it.classList.contains('lv-zhang') ? 'zhang' : 'ke';
  }
  function kidsOf(it) { return it ? it.querySelector(':scope > .ot-kids') : null; }
  function items(box) { return box ? [].filter.call(box.children, function (n) { return n.classList.contains('ot-item'); }) : []; }
  function setNum(it, s) { var n = it.querySelector('.ot-num'); if (n) n.textContent = s; }

  function makeItem(type, name) {
    var d = document.createElement('div');
    d.className = 'ot-item lv-' + type;
    var badge = type === 'pian' ? '篇' : type === 'zhang' ? '章' : '·';
    var chev = type === 'ke' ? '<span class="ot-chev leaf"></span>' : '<button class="ot-chev" type="button" aria-label="折叠"></button>';
    var addBtn = type === 'ke' ? '' : '<button type="button" title="添加' + (type === 'pian' ? '章' : '课时') + '" data-act="addkid">＋</button>';
    d.innerHTML =
      '<div class="ot-row">' + chev +
      '<span class="ot-grip" draggable="true" title="拖拽挪位">⠿</span>' +
      '<span class="ot-badge">' + badge + '</span>' +
      '<div class="ot-main"><div class="ot-title">' + (type === 'ke' ? '' : '<span class="ot-num"></span>') +
      '<span class="ot-name">' + name + '</span></div>' +
      (type === 'ke'
        ? '<div class="ot-meta"><span class="warn-t">待补出处与估时</span></div>'
        : '<div class="ot-meta"><span class="ot-cnt"></span></div>') +
      '</div>' +
      '<span class="ot-acts"><button type="button" title="改名" data-act="rename">✎</button>' +
      '<button type="button" title="上移" data-act="up">↑</button>' +
      '<button type="button" title="下移" data-act="down">↓</button>' + addBtn +
      '<button type="button" title="删除" data-act="del">✕</button></span></div>' +
      (type === 'ke' ? '' : '<div class="ot-kids"></div>');
    return d;
  }

  function refresh(root) {
    var pianNo = 0, zhangNo = 0, keNo = 0;
    function badge(it, s) { var b = it.querySelector('.ot-badge'); if (b) b.textContent = s; }
    function recount(it) {
      var n = it.querySelectorAll('.lv-ke').length;
      var z = it.querySelectorAll(':scope > .ot-kids > .lv-zhang').length;
      it.classList.toggle('ot-empty', typeOf(it) === 'zhang' && n === 0);
      var c = it.querySelector('.ot-cnt');
      if (c) c.textContent = typeOf(it) === 'pian'
        ? (z + ' 章 · ' + n + ' 课时')
        : (n === 0 ? '0 课时 · 证据不足' : n + ' 课时');
    }
    function walkZhang(z) {
      zhangNo++;
      setNum(z, '第' + CN[zhangNo - 1] + '章');
      var i = 0;
      items(kidsOf(z)).forEach(function (k) {
        if (typeOf(k) !== 'ke') return;
        i++;
        badge(k, i);
      });
      recount(z);
    }
    items(root).forEach(function (it) {
      var t = typeOf(it);
      if (t === 'ke') {
        keNo++;
        badge(it, keNo);
      } else if (t === 'zhang') {
        walkZhang(it);
      } else {
        pianNo++;
        setNum(it, '第' + CN[pianNo - 1] + '篇');
        items(kidsOf(it)).forEach(function (c) { if (typeOf(c) === 'zhang') walkZhang(c); });
        recount(it);
      }
    });
  }

  function startRename(it) {
    var n = it.querySelector('.ot-name');
    if (!n) return;
    n.contentEditable = 'true';
    n.focus();
    var r = document.createRange();
    r.selectNodeContents(n);
    var s = getSelection();
    s.removeAllRanges();
    s.addRange(r);
  }

  function clearDrops(root) {
    root.querySelectorAll('.drop-before,.drop-after').forEach(function (n) { n.classList.remove('drop-before', 'drop-after'); });
  }

  document.querySelectorAll('.ot').forEach(function (root) {
    refresh(root);

    root.addEventListener('click', function (e) {
      var chev = e.target.closest('.ot-chev');
      if (chev && !chev.classList.contains('leaf')) { chev.closest('.ot-item').classList.toggle('closed'); return; }
      var addBtn = e.target.closest('.ot-add');
      if (addBtn) {
        var it = makeItem('ke', '新课时');
        root.appendChild(it);
        refresh(root);
        startRename(it);
        return;
      }
      var btn = e.target.closest('.ot-acts button');
      if (!btn) return;
      var item = btn.closest('.ot-item');
      var act = btn.dataset.act;
      if (act === 'rename') {
        startRename(item);
      } else if (act === 'up' || act === 'down') {
        var sib = act === 'up' ? item.previousElementSibling : item.nextElementSibling;
        while (sib && !sib.classList.contains('ot-item')) sib = act === 'up' ? sib.previousElementSibling : sib.nextElementSibling;
        if (sib) item.parentElement.insertBefore(item, act === 'up' ? sib : sib.nextSibling);
        refresh(root);
      } else if (act === 'del') {
        item.remove();
        refresh(root);
      } else if (act === 'addkid') {
        var t = typeOf(item) === 'pian' ? 'zhang' : 'ke';
        var kid = makeItem(t, t === 'zhang' ? '新章节' : '新课时');
        kidsOf(item).appendChild(kid);
        item.classList.remove('closed');
        refresh(root);
        startRename(kid);
      }
    });

    root.addEventListener('dblclick', function (e) {
      if (e.target.classList.contains('ot-name')) startRename(e.target.closest('.ot-item'));
    });
    root.addEventListener('keydown', function (e) {
      if (e.target.classList && e.target.classList.contains('ot-name') && (e.key === 'Enter' || e.key === 'Escape')) {
        e.preventDefault();
        e.target.blur();
      }
    });
    root.addEventListener('focusout', function (e) {
      if (e.target && e.target.classList && e.target.classList.contains('ot-name')) e.target.contentEditable = 'false';
    });

    /* 拖拽：只允许同类型节点前后插入，保证篇>章>课的层级约束不被破坏 */
    var dragEl = null;
    root.addEventListener('dragstart', function (e) {
      var grip = e.target.closest && e.target.closest('.ot-grip');
      if (!grip) return;
      dragEl = grip.closest('.ot-item');
      dragEl.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setDragImage(dragEl.querySelector('.ot-row'), 12, 12); } catch (_) {}
    });
    root.addEventListener('dragover', function (e) {
      if (!dragEl) return;
      var t = e.target.closest && e.target.closest('.ot-item');
      clearDrops(root);
      if (!t || t === dragEl || dragEl.contains(t) || typeOf(t) !== typeOf(dragEl)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      var r = t.getBoundingClientRect();
      t.classList.add(e.clientY < r.top + r.height / 2 ? 'drop-before' : 'drop-after');
    });
    root.addEventListener('drop', function (e) {
      if (!dragEl) return;
      var t = e.target.closest && e.target.closest('.ot-item');
      if (t && t !== dragEl && !dragEl.contains(t) && typeOf(t) === typeOf(dragEl)) {
        if (t.classList.contains('drop-before')) t.parentElement.insertBefore(dragEl, t);
        else t.parentElement.insertBefore(dragEl, t.nextSibling);
      }
      clearDrops(root);
      dragEl.classList.remove('dragging');
      dragEl = null;
      refresh(root);
    });
    root.addEventListener('dragend', function () {
      clearDrops(root);
      if (dragEl) { dragEl.classList.remove('dragging'); dragEl = null; }
    });
  });
})();
