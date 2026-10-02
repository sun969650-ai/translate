/** 极简 Markdown 渲染器（安全转义后渲染），供内容脚本与弹窗使用。 */
(function (root) {
  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function inline(text) {
    let out = escapeHtml(text);
    out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, href) => {
      const safe = /^(https?:|mailto:|#)/i.test(href) ? href : '#';
      return `<a href="${safe}" target="_blank" rel="noreferrer">${label}</a>`;
    });
    return out;
  }

  function render(markdown) {
    const src = String(markdown == null ? '' : markdown).replace(/\r\n/g, '\n');
    const lines = src.split('\n');
    const html = [];
    let listType = null;
    let inCode = false;
    let paragraph = [];

    const closeParagraph = () => {
      if (paragraph.length) {
        html.push('<p>' + paragraph.join('<br>') + '</p>');
        paragraph = [];
      }
    };
    const closeList = () => {
      if (listType) {
        html.push('</' + listType + '>');
        listType = null;
      }
    };

    for (const raw of lines) {
      const line = raw.trimEnd();
      if (/^\s*```/.test(line)) {
        closeParagraph();
        closeList();
        if (!inCode) {
          html.push('<pre><code>');
          inCode = true;
        } else {
          html.push('</code></pre>');
          inCode = false;
        }
        continue;
      }
      if (inCode) {
        html.push(escapeHtml(raw) + '\n');
        continue;
      }
      if (!line.trim()) {
        closeParagraph();
        closeList();
        continue;
      }
      const heading = line.match(/^(#{1,6})\s+(.*)$/);
      if (heading) {
        closeParagraph();
        closeList();
        const level = Math.min(heading[1].length + 1, 6);
        html.push(`<h${level}>${inline(heading[2])}</h${level}>`);
        continue;
      }
      const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
      const ordered = line.match(/^\s*\d+[.)]\s+(.*)$/);
      if (bullet || ordered) {
        closeParagraph();
        const wanted = bullet ? 'ul' : 'ol';
        if (listType && listType !== wanted) closeList();
        if (!listType) {
          html.push('<' + wanted + '>');
          listType = wanted;
        }
        html.push('<li>' + inline((bullet || ordered)[1]) + '</li>');
        continue;
      }
      if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) {
        closeParagraph();
        closeList();
        html.push('<hr>');
        continue;
      }
      closeList();
      paragraph.push(inline(line));
    }
    closeParagraph();
    closeList();
    if (inCode) html.push('</code></pre>');
    return html.join('\n');
  }

  const api = { render, escapeHtml };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.AITMarkdown = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
