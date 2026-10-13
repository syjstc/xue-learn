/** A UI-only plugin: React, UI components and workspace access come from Desktop. */
export function createView(host) {
  const { createElement: h, useEffect, useMemo, useState } = host.React;
  const { Button, Card, CardHeader, CardTitle, CardDescription, CardContent, Input, Badge } = host.ui;
  const { InlineMathText } = host.core.display;

  function message(error) {
    return error instanceof Error ? error.message : String(error);
  }

  return function CourseBrowser() {
    const [catalog, setCatalog] = useState([]);
    const [query, setQuery] = useState('');
    const [selectedId, setSelectedId] = useState(null);
    const [snapshot, setSnapshot] = useState(null);
    const [catalogLoading, setCatalogLoading] = useState(true);
    const [unitLoading, setUnitLoading] = useState(false);
    const [catalogError, setCatalogError] = useState('');
    const [unitError, setUnitError] = useState('');
    const [revision, setRevision] = useState(0);

    useEffect(() => {
      let current = true;
      setCatalogLoading(true);
      setCatalogError('');
      // No URL, token, database connection or backend belongs to this plugin.
      host.core.courseSource.catalog().then(rows => {
        if (!current || host.signal.aborted) return;
        setCatalog(rows);
        setSelectedId(previous => rows.some(row => row.unitId === previous) ? previous : null);
      }).catch(error => {
        if (current && !host.signal.aborted) setCatalogError(message(error));
      }).finally(() => {
        if (current && !host.signal.aborted) setCatalogLoading(false);
      });
      return () => { current = false; };
    }, [revision]);

    useEffect(() => {
      let current = true;
      setSnapshot(null);
      setUnitError('');
      setUnitLoading(Boolean(selectedId));
      if (selectedId) {
        host.core.courseSource.readUnit(selectedId).then(result => {
          if (current && !host.signal.aborted) {
            setSnapshot(result);
            if (!result) setUnitError('这节课程已不存在，请刷新课程目录。');
          }
        }).catch(error => {
          if (current && !host.signal.aborted) setUnitError(message(error));
        }).finally(() => {
          if (current && !host.signal.aborted) setUnitLoading(false);
        });
      }
      // Ignore stale results if another unit is selected before this read finishes.
      return () => { current = false; };
    }, [selectedId, revision]);

    const visible = useMemo(() => {
      const term = query.trim().toLocaleLowerCase();
      return catalog.filter(row => !term || [row.title, row.goalTitle, row.moduleTitle, row.spaceName]
        .filter(Boolean).join(' ').toLocaleLowerCase().includes(term));
    }, [catalog, query]);

    const selected = catalog.find(row => row.unitId === selectedId);
    const errorCard = (title, detail, retry) => h(Card, { role: 'alert', className: 'course-browser-error' },
      h(CardHeader, null, h(CardTitle, null, title), h(CardDescription, null, detail)),
      h(CardContent, null, h(Button, { onClick: retry }, '重试')));

    return h('div', { className: 'course-browser' },
      h('div', { className: 'course-browser-toolbar' },
        h('div', null, h('h2', null, '课程浏览器'), h('p', null, '浏览当前工作区的课程与已保存章节。')),
        h(Button, { variant: 'outline', disabled: catalogLoading || unitLoading, onClick: () => setRevision(value => value + 1) }, '刷新')),
      h(Input, { type: 'search', value: query, onChange: event => setQuery(event.target.value),
        placeholder: '搜索课程、章节或空间', 'aria-label': '搜索课程、章节或空间', className: 'course-browser-search' }),
      catalogError ? errorCard('课程目录暂时无法读取', catalogError, () => setRevision(value => value + 1)) :
      h('div', { className: 'course-browser-layout' },
        h('section', { className: 'course-browser-catalog', 'aria-label': '课程列表', 'aria-busy': catalogLoading },
          h('p', { className: 'course-browser-count', role: 'status' }, catalogLoading ? '正在读取课程…' : `${visible.length} 节课程`),
          !catalogLoading && !visible.length ? h(Card, null,
            h(CardHeader, null, h(CardTitle, null, query ? '没有匹配的课程' : '当前工作区还没有课程'),
              h(CardDescription, null, query ? '试试更短的关键词。' : '在宿主中创建课程后，点击刷新。'))) :
          visible.map(row => h(Button, { key: row.unitId, type: 'button',
            variant: row.unitId === selectedId ? 'secondary' : 'ghost',
            className: 'course-browser-unit', 'aria-pressed': row.unitId === selectedId,
            onClick: () => setSelectedId(row.unitId) },
          h('span', { className: 'course-browser-unit-title' }, row.title),
          h('span', { className: 'course-browser-unit-context' }, [row.spaceName, row.goalTitle, row.moduleTitle].filter(Boolean).join(' / '))))),
        h('section', { className: 'course-browser-detail', 'aria-label': '课程详情', 'aria-busy': unitLoading },
          unitError ? errorCard('课程内容暂时无法读取', unitError, () => setRevision(value => value + 1)) :
          unitLoading ? h(Card, null, h(CardHeader, null, h(CardTitle, { role: 'status' }, '正在读取课程内容…'))) :
          !snapshot ? h(Card, null, h(CardHeader, null,
            h(CardTitle, null, '选择一节课程'), h(CardDescription, null, '左侧课程直接来自宿主当前工作区。'))) :
          h('div', { className: 'course-browser-sections' },
            h(Card, null, h(CardHeader, null,
              h(CardTitle, null, snapshot.metadata.title),
              h(CardDescription, null, [selected?.goalTitle, selected?.moduleTitle].filter(Boolean).join(' / '))),
            h(CardContent, null,
              snapshot.metadata.scope ? h('div', { className: 'course-browser-copy' },
                h(InlineMathText, { text: snapshot.metadata.scope, fitToContainer: true })) : null,
              h(Badge, { variant: 'secondary' }, `${snapshot.sections.length} 个章节`))),
            snapshot.sections.length ? snapshot.sections.map(section => h(Card, { key: section.id },
              h(CardHeader, null, h(CardTitle, null, section.title),
                h(CardDescription, null, section.availability === 'published' ? '已保存内容' : '尚未生成内容')),
              h(CardContent, null,
                section.material?.introduction || section.scope ? h('div', { className: 'course-browser-copy' },
                  h(InlineMathText, { text: section.material?.introduction || section.scope, fitToContainer: true })) : h('p', null, '本章节暂时没有文字简介。')))) :
              h(Card, null, h(CardHeader, null, h(CardDescription, null, '这节课程尚未保存章节内容。')))))));
  };
}
