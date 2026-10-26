(() => {
  const fallbackEscape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char]);

  const card = (question, index, escapeHtml) => {
    const escape = escapeHtml || fallbackEscape;
    const hasEvidence = question.description || question.why || question.observation || question.referenceAnswer;
    return `<article class="qb-card"><div class="qb-card-number">${String(index + 1).padStart(2, '0')}</div><div class="qb-card-body"><div class="qb-tags"><span>${escape(question.category || question.dimension || '结构化面试')}</span><span>${escape(question.source || '岗位基础题')}</span>${question.status ? `<span>${escape(question.status)}</span>` : ''}</div><h3>${escape(question.title || question.question)}</h3>${question.position ? `<p class="qb-role">${escape(question.position)}</p>` : ''}${hasEvidence ? `<details><summary>查看追问提示与观察要点</summary>${question.description || question.why ? `<p>${escape(question.description || question.why)}</p>` : ''}${question.observation || question.referenceAnswer ? `<div class="qb-evidence"><b>观察要点 / 参考答案</b><p>${escape(question.observation || question.referenceAnswer)}</p></div>` : ''}</details>` : '<p class="qb-muted">结合候选人的具体经历追问，记录可核验的事实。</p>'}</div></article>`;
  };

  window.renderInterviewQuestionCard = (question, index, escapeHtml) => card(question, index, escapeHtml);
  window.renderInterviewQuestionCards = (questions, escapeHtml) => `<div class="qb-question-cards">${questions.map((question, index) => card(question, index, escapeHtml)).join('')}</div>`;
})();
