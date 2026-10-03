/* 展示站交互：滚动入场 + 导航高亮 + FAQ 手风琴（原生 details 兜底） */
(function () {
  'use strict';

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- 滚动入场 ---------- */
  var targets = document.querySelectorAll(
    '.card, .mini, .panel, .steps > li, .faq > details, .section-head'
  );
  var showAll = function () {
    targets.forEach(function (el) { el.classList.add('in'); });
  };
  if (reduce || !('IntersectionObserver' in window)) {
    showAll();
  } else {
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry, i) {
          if (!entry.isIntersecting) return;
          var el = entry.target;
          setTimeout(function () { el.classList.add('in'); }, i * 70);
          io.unobserve(el);
        });
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 }
    );
    targets.forEach(function (el) {
      el.classList.add('reveal');
      io.observe(el);
    });
    // 兜底：3 秒后仍未滚动到的内容也直接显示，避免异常情况下内容不可见
    setTimeout(showAll, 3000);
  }

  /* ---------- 导航高亮 ---------- */
  var links = Array.prototype.slice.call(document.querySelectorAll('.nav-links a'));
  var sections = links
    .map(function (a) { return document.querySelector(a.getAttribute('href')); })
    .filter(Boolean);

  if ('IntersectionObserver' in window && sections.length) {
    var spy = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          links.forEach(function (a) {
            a.style.color =
              a.getAttribute('href') === '#' + entry.target.id ? 'var(--fg)' : '';
          });
        });
      },
      { rootMargin: '-45% 0px -50% 0px' }
    );
    sections.forEach(function (s) { spy.observe(s); });
  }
})();
