/**
 * Ona Polisi - Ona AI Legal Companion & Case Progress Assistant
 * Powered by Google Gemini (gemini-3.5-flash-lite)
 */

(function () {
  'use strict';

  // Prevent multiple injections
  if (document.getElementById('ona-ai-root')) return;

  // Insert styles
  const style = document.createElement('style');
  style.id = 'ona-ai-styles';
  style.textContent = `
    /* Floating Launcher Button */
    .ona-ai-launcher {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 99990;
      display: inline-flex;
      align-items: center;
      gap: 10px;
      padding: 12px 22px;
      background: linear-gradient(135deg, #064E3B 0%, #0B6B3A 100%);
      color: #FFFFFF;
      border: 1.5px solid rgba(255, 255, 255, 0.35);
      border-top: 1.5px solid rgba(255, 255, 255, 0.7);
      border-radius: 999px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      font-size: 0.94rem;
      font-weight: 750;
      letter-spacing: -0.01em;
      cursor: pointer;
      box-shadow: 0 10px 28px rgba(6, 78, 59, 0.35), 0 0 20px rgba(11, 107, 58, 0.25), inset 0 1px 2px rgba(255, 255, 255, 0.5);
      transition: all 0.28s cubic-bezier(0.16, 1, 0.3, 1);
      user-select: none;
    }
    .ona-ai-launcher:hover {
      transform: translateY(-3px) scale(1.02);
      box-shadow: 0 14px 34px rgba(6, 78, 59, 0.45), 0 0 26px rgba(11, 107, 58, 0.35), inset 0 1px 2px rgba(255, 255, 255, 0.7);
    }
    .ona-ai-launcher:active {
      transform: translateY(0) scale(0.98);
    }
    .ona-ai-sparkle {
      display: inline-grid;
      place-items: center;
      width: 24px;
      height: 24px;
      background: linear-gradient(135deg, #FEF08A 0%, #F59E0B 100%);
      color: #78350F;
      border-radius: 50%;
      font-size: 0.8rem;
      box-shadow: 0 0 12px rgba(245, 158, 11, 0.5);
      animation: pulseSparkle 2.6s infinite ease-in-out;
    }
    @keyframes pulseSparkle {
      0%, 100% { transform: scale(1); filter: brightness(1); }
      50% { transform: scale(1.12); filter: brightness(1.2); }
    }

    /* Modal Backdrop */
    .ona-ai-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(15, 20, 25, 0.45);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      z-index: 99995;
      opacity: 0;
      visibility: hidden;
      transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .ona-ai-backdrop.is-open {
      opacity: 1;
      visibility: visible;
    }

    /* Slide-up / Floating Drawer */
    .ona-ai-drawer {
      position: fixed;
      bottom: 24px;
      right: 24px;
      width: 440px;
      max-width: calc(100vw - 32px);
      height: 640px;
      max-height: calc(100vh - 48px);
      background: #FFFFFF;
      border-radius: 24px;
      border: 1px solid rgba(226, 232, 240, 0.95);
      box-shadow: 0 24px 60px rgba(15, 20, 25, 0.22), 0 0 40px rgba(6, 78, 59, 0.12);
      display: flex;
      flex-direction: column;
      z-index: 99996;
      opacity: 0;
      visibility: hidden;
      transform: translateY(24px) scale(0.97);
      transition: all 0.32s cubic-bezier(0.16, 1, 0.3, 1);
      overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    }
    .ona-ai-drawer.is-open {
      opacity: 1;
      visibility: visible;
      transform: translateY(0) scale(1);
    }

    /* Header */
    .ona-ai-header {
      padding: 18px 20px;
      background: linear-gradient(135deg, #064E3B 0%, #0B6B3A 100%);
      color: #FFFFFF;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid rgba(255, 255, 255, 0.15);
    }
    .ona-ai-header-info {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .ona-ai-avatar {
      width: 40px;
      height: 40px;
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.16);
      border: 1px solid rgba(255, 255, 255, 0.3);
      display: grid;
      place-items: center;
      font-size: 1.2rem;
    }
    .ona-ai-title {
      font-size: 1.02rem;
      font-weight: 800;
      letter-spacing: -0.02em;
      margin: 0;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .ona-ai-sub {
      font-size: 0.78rem;
      color: #D1FAE5;
      margin: 2px 0 0;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .ona-ai-online-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #34D399;
      box-shadow: 0 0 6px #34D399;
    }
    .ona-ai-close-btn {
      background: rgba(255, 255, 255, 0.12);
      border: 1px solid rgba(255, 255, 255, 0.25);
      color: #FFFFFF;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      display: grid;
      place-items: center;
      font-size: 1rem;
      cursor: pointer;
      transition: all 0.2s;
    }
    .ona-ai-close-btn:hover {
      background: rgba(255, 255, 255, 0.25);
      transform: scale(1.08);
    }

    /* Context Pill in chat header if active */
    .ona-ai-context-strip {
      padding: 8px 16px;
      background: #F1FBF5;
      border-bottom: 1px solid #D1FAE5;
      font-size: 0.8rem;
      color: #064E3B;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .ona-ai-context-tag {
      font-weight: 800;
      background: #D1FAE5;
      padding: 2px 8px;
      border-radius: 6px;
      color: #064E3B;
      letter-spacing: 0.02em;
    }

    /* Chat Messages Body */
    .ona-ai-body {
      flex: 1;
      padding: 18px;
      overflow-y: auto;
      background: #F8FAFC;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    /* Message Bubbles */
    .ona-ai-msg {
      display: flex;
      flex-direction: column;
      max-width: 90%;
      line-height: 1.55;
      font-size: 0.91rem;
      animation: fadeInMsg 0.25s ease-out;
    }
    @keyframes fadeInMsg {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .ona-ai-msg.bot {
      align-self: flex-start;
      color: #1E293B;
    }
    .ona-ai-msg.user {
      align-self: flex-end;
      background: linear-gradient(135deg, #064E3B 0%, #0B6B3A 100%);
      color: #FFFFFF;
      padding: 12px 18px;
      border-radius: 18px 18px 4px 18px;
      box-shadow: 0 4px 14px rgba(6, 78, 59, 0.15);
    }
    .ona-ai-bot-content {
      background: #FFFFFF;
      padding: 16px 18px;
      border-radius: 18px 18px 18px 4px;
      border: 1px solid rgba(226, 232, 240, 0.9);
      box-shadow: 0 4px 14px rgba(15, 20, 25, 0.04);
    }
    .ona-ai-bot-content h3, .ona-ai-bot-content h4 {
      margin: 10px 0 6px;
      color: #064E3B;
      font-size: 0.98rem;
      font-weight: 800;
    }
    .ona-ai-bot-content p {
      margin: 0 0 10px;
    }
    .ona-ai-bot-content ul, .ona-ai-bot-content ol {
      margin: 6px 0 12px;
      padding-left: 20px;
    }
    .ona-ai-bot-content li {
      margin-bottom: 5px;
    }
    .ona-ai-bot-content strong {
      color: #0F172A;
      font-weight: 750;
    }
    .ona-ai-bot-content hr {
      border: none;
      border-top: 1px solid #E2E8F0;
      margin: 12px 0;
    }

    /* Case badge inside chat */
    .ona-ai-case-card {
      margin: 6px 0 12px;
      padding: 10px 14px;
      background: #F0FDF4;
      border: 1.5px solid #86EFAC;
      border-radius: 12px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      font-size: 0.84rem;
    }
    .ona-ai-case-card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-weight: 800;
      color: #064E3B;
    }
    .ona-ai-case-status-badge {
      padding: 2px 8px;
      border-radius: 999px;
      background: #064E3B;
      color: #FFFFFF;
      font-size: 0.74rem;
      font-weight: 750;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    /* Quick Action Chips */
    .ona-ai-chips-wrap {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 8px;
    }
    .ona-ai-chip {
      background: linear-gradient(135deg, #E6F5EC 0%, #D4EFE0 100%);
      color: #064E3B;
      border: 1px solid rgba(6, 78, 59, 0.2);
      border-radius: 999px;
      padding: 7px 14px;
      font-size: 0.81rem;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.2s;
    }
    .ona-ai-chip:hover {
      background: linear-gradient(135deg, #D6F1E2 0%, #BFE8D2 100%);
      transform: translateY(-1.5px);
      box-shadow: 0 4px 10px rgba(6, 78, 59, 0.12);
    }

    /* Typing indicator */
    .ona-ai-typing {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 16px;
      background: #FFFFFF;
      border: 1px solid #E2E8F0;
      border-radius: 18px;
      width: fit-content;
      color: #64748B;
      font-size: 0.84rem;
    }
    .ona-ai-dots {
      display: flex;
      gap: 4px;
    }
    .ona-ai-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #064E3B;
      animation: bounceDot 1.4s infinite ease-in-out both;
    }
    .ona-ai-dot:nth-child(1) { animation-delay: -0.32s; }
    .ona-ai-dot:nth-child(2) { animation-delay: -0.16s; }
    @keyframes bounceDot {
      0%, 80%, 100% { transform: scale(0); opacity: 0.4; }
      40% { transform: scale(1); opacity: 1; }
    }

    /* Input Footer */
    .ona-ai-footer {
      padding: 14px 18px;
      background: #FFFFFF;
      border-top: 1px solid rgba(226, 232, 240, 0.9);
      display: flex;
      gap: 10px;
      align-items: center;
    }
    .ona-ai-input {
      flex: 1;
      min-height: 44px;
      max-height: 100px;
      padding: 10px 16px;
      border: 1.5px solid #CBD5E1;
      border-radius: 999px;
      font-size: 0.92rem;
      outline: none;
      transition: all 0.2s;
      font-family: inherit;
    }
    .ona-ai-input:focus {
      border-color: #064E3B;
      box-shadow: 0 0 0 3px rgba(6, 78, 59, 0.12);
    }
    .ona-ai-send-btn {
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: linear-gradient(135deg, #064E3B 0%, #0B6B3A 100%);
      color: #FFFFFF;
      border: none;
      display: grid;
      place-items: center;
      cursor: pointer;
      flex-shrink: 0;
      transition: all 0.22s;
      box-shadow: 0 4px 12px rgba(6, 78, 59, 0.25);
    }
    .ona-ai-send-btn:hover {
      transform: scale(1.06);
      box-shadow: 0 6px 16px rgba(6, 78, 59, 0.35);
    }
    .ona-ai-send-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      transform: none;
    }

    /* Mobile adjustments */
    @media (max-width: 600px) {
      .ona-ai-drawer {
        bottom: 0;
        right: 0;
        width: 100vw;
        max-width: 100vw;
        height: 85vh;
        max-height: 85vh;
        border-radius: 20px 20px 0 0;
      }
      .ona-ai-launcher {
        bottom: 18px;
        right: 18px;
        padding: 10px 18px;
        font-size: 0.88rem;
      }
    }
  `;
  document.head.appendChild(style);

  // Parse current URL or page for active case
  function getCurrentPageCaseId() {
    const urlParams = new URLSearchParams(window.location.search);
    const fromUrl = urlParams.get('case') || urlParams.get('id');
    if (fromUrl) return fromUrl.toUpperCase().trim();

    // Check DOM if on Case.html
    const caseIdEl = document.getElementById('case-id');
    if (caseIdEl && caseIdEl.textContent.trim().startsWith('OP-')) {
      return caseIdEl.textContent.trim().toUpperCase();
    }
    return null;
  }

  // Create UI Elements
  const root = document.createElement('div');
  root.id = 'ona-ai-root';

  // Launcher Button
  const launcher = document.createElement('button');
  launcher.className = 'ona-ai-launcher';
  launcher.type = 'button';
  launcher.setAttribute('aria-label', 'Open Ona AI Legal Companion');
  launcher.innerHTML = `
    <span class="ona-ai-sparkle">✨</span>
    <span>Ask Ona AI</span>
  `;

  // Backdrop
  const backdrop = document.createElement('div');
  backdrop.className = 'ona-ai-backdrop';

  // Drawer
  const drawer = document.createElement('div');
  drawer.className = 'ona-ai-drawer';
  drawer.innerHTML = `
    <div class="ona-ai-header">
      <div class="ona-ai-header-info">
        <div class="ona-ai-avatar">⚖️</div>
        <div>
          <h3 class="ona-ai-title">Ona AI · Case Companion</h3>
          <div class="ona-ai-sub">
            <span class="ona-ai-online-dot"></span>
            <span>Gemini Intelligence · Constitutional Rights</span>
          </div>
        </div>
      </div>
      <button class="ona-ai-close-btn" type="button" aria-label="Close Ona AI">✕</button>
    </div>
    <div class="ona-ai-context-strip" id="ona-ai-context-strip" style="display: none;">
      <span>Active Reference:</span>
      <span class="ona-ai-context-tag" id="ona-ai-active-code">OP-2026-778899</span>
    </div>
    <div class="ona-ai-body" id="ona-ai-messages">
      <!-- Initial Bot Message -->
      <div class="ona-ai-msg bot">
        <div class="ona-ai-bot-content">
          <p><strong>Hujambo! I am Ona AI</strong> — your legal companion and case navigator on Ona Polisi.</p>
          <p>You can give me your <strong>case code</strong> (e.g., <code>OP-2026-778899</code>) and I will read your records to explain exactly how your case is progressing, what our pro-bono advocates are doing, and what to expect next.</p>
          <p style="margin-bottom: 6px;"><strong>Quick questions you can ask:</strong></p>
          <div class="ona-ai-chips-wrap">
            <button class="ona-ai-chip" type="button" data-prompt="Check case progress for OP-2026-778899">🔍 Check case OP-2026-778899</button>
            <button class="ona-ai-chip" type="button" data-prompt="What are my rights if arrested by police under Article 49?">⚖️ My rights if arrested (Art. 49)</button>
            <button class="ona-ai-chip" type="button" data-prompt="Can police hold me beyond 24 hours without court?">⏱️ The 24-hour court rule</button>
            <button class="ona-ai-chip" type="button" data-prompt="How does Ona Polisi protect my evidence and identity?">🛡️ How is my identity protected?</button>
          </div>
        </div>
      </div>
    </div>
    <form class="ona-ai-footer" id="ona-ai-form">
      <input type="text" class="ona-ai-input" id="ona-ai-input" placeholder="Ask a question or enter case code..." autocomplete="off" />
      <button type="submit" class="ona-ai-send-btn" id="ona-ai-send" aria-label="Send query">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="22" y1="2" x2="11" y2="13"></line>
          <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
        </svg>
      </button>
    </form>
  `;

  root.appendChild(launcher);
  root.appendChild(backdrop);
  root.appendChild(drawer);
  document.body.appendChild(root);

  // References
  const messagesBox = drawer.querySelector('#ona-ai-messages');
  const chatForm = drawer.querySelector('#ona-ai-form');
  const chatInput = drawer.querySelector('#ona-ai-input');
  const sendBtn = drawer.querySelector('#ona-ai-send');
  const closeBtn = drawer.querySelector('.ona-ai-close-btn');
  const contextStrip = drawer.querySelector('#ona-ai-context-strip');
  const activeCodeEl = drawer.querySelector('#ona-ai-active-code');

  // Markdown simple renderer
  function renderMarkdown(text) {
    if (!text) return '';
    let html = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      // Bold
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      // Italic
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      // Headers
      .replace(/^### (.*$)/gim, '<h3>$1</h3>')
      .replace(/^## (.*$)/gim, '<h3>$1</h3>')
      .replace(/^# (.*$)/gim, '<h3>$1</h3>')
      // Blockquotes or HR
      .replace(/^---$/gim, '<hr />')
      // Code tags
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      // Unordered lists
      .replace(/^\* (.*$)/gim, '<li>$1</li>')
      .replace(/^- (.*$)/gim, '<li>$1</li>');

    // Wrap list items
    html = html.replace(/(<li>.*<\/li>)/gims, '<ul>$1</ul>');
    // Wrap loose paragraphs
    html = html.split('\n\n').map(p => {
      p = p.trim();
      if (!p) return '';
      if (p.startsWith('<h3>') || p.startsWith('<ul>') || p.startsWith('<hr')) return p;
      return `<p>${p.replace(/\n/g, '<br />')}</p>`;
    }).join('');

    return html;
  }

  // Toggle Drawer
  function openDrawer(prefillCode) {
    drawer.classList.add('is-open');
    backdrop.classList.add('is-open');
    chatInput.focus();

    const activeCode = prefillCode || getCurrentPageCaseId();
    if (activeCode) {
      contextStrip.style.display = 'flex';
      activeCodeEl.textContent = activeCode;
    } else {
      contextStrip.style.display = 'none';
    }
  }

  function closeDrawer() {
    drawer.classList.remove('is-open');
    backdrop.classList.remove('is-open');
  }

  launcher.addEventListener('click', () => openDrawer());
  closeBtn.addEventListener('click', closeDrawer);
  backdrop.addEventListener('click', closeDrawer);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && drawer.classList.contains('is-open')) {
      closeDrawer();
    }
  });

  // Append User Message
  function appendUserMessage(text) {
    const wrap = document.createElement('div');
    wrap.className = 'ona-ai-msg user';
    wrap.textContent = text;
    messagesBox.appendChild(wrap);
    messagesBox.scrollTop = messagesBox.scrollHeight;
  }

  // Append Bot Message
  function appendBotMessage(htmlContent, caseSummary) {
    const wrap = document.createElement('div');
    wrap.className = 'ona-ai-msg bot';
    
    let summaryHtml = '';
    if (caseSummary) {
      summaryHtml = `
        <div class="ona-ai-case-card">
          <div class="ona-ai-case-card-header">
            <span>Case Reference: ${caseSummary.case_id}</span>
            <span class="ona-ai-case-status-badge">${caseSummary.status}</span>
          </div>
          <div style="color: #334155; margin-top: 4px;">
            <div><strong>Category:</strong> ${caseSummary.category}</div>
            <div><strong>Evidence Hashed:</strong> ${caseSummary.evidenceCount} file(s)</div>
            <div><strong>Legal Aid:</strong> ${caseSummary.hasAdvocate ? 'Assigned to LSK Advocate' : 'Matching pro-bono pool'}</div>
          </div>
        </div>
      `;
    }

    wrap.innerHTML = `
      <div class="ona-ai-bot-content">
        ${summaryHtml}
        ${htmlContent}
      </div>
    `;
    messagesBox.appendChild(wrap);
    messagesBox.scrollTop = messagesBox.scrollHeight;
  }

  // Show Typing indicator
  function showTyping() {
    const indicator = document.createElement('div');
    indicator.className = 'ona-ai-typing';
    indicator.id = 'ona-ai-typing-indicator';
    indicator.innerHTML = `
      <div class="ona-ai-dots">
        <span class="ona-ai-dot"></span>
        <span class="ona-ai-dot"></span>
        <span class="ona-ai-dot"></span>
      </div>
      <span>Ona AI is analyzing case records...</span>
    `;
    messagesBox.appendChild(indicator);
    messagesBox.scrollTop = messagesBox.scrollHeight;
    return indicator;
  }

  function hideTyping() {
    const ind = document.getElementById('ona-ai-typing-indicator');
    if (ind) ind.remove();
  }

  // Submit Query
  async function sendQuery(queryText, explicitCaseId) {
    if (!queryText || queryText.trim().length === 0) return;
    const userText = queryText.trim();
    chatInput.value = '';
    appendUserMessage(userText);

    sendBtn.disabled = true;
    const typing = showTyping();

    const activeCase = explicitCaseId || getCurrentPageCaseId();

    try {
      const response = await fetch('/api/ai/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userText,
          case_id: activeCase
        })
      });

      const data = await response.json();
      hideTyping();

      if (!response.ok || !data.success) {
        appendBotMessage(`<p style="color: #DC2626;"><strong>Notice:</strong> ${data.error || 'The AI assistant is temporarily unreachable. Please try again.'}</p>`);
      } else {
        const parsedHtml = renderMarkdown(data.answer);
        appendBotMessage(parsedHtml, data.caseSummary);
      }
    } catch (err) {
      hideTyping();
      appendBotMessage(`<p style="color: #DC2626;"><strong>Connection Error:</strong> Could not connect to Ona AI. Please check your network connection.</p>`);
    } finally {
      sendBtn.disabled = false;
      chatInput.focus();
    }
  }

  // Handle Form Submit
  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    sendQuery(chatInput.value);
  });

  // Handle Quick Chips
  messagesBox.addEventListener('click', (e) => {
    const chip = e.target.closest('.ona-ai-chip');
    if (chip) {
      const prompt = chip.getAttribute('data-prompt');
      if (prompt) {
        sendQuery(prompt);
      }
    }
  });

  // Hook for "Explain with AI" buttons across pages
  document.addEventListener('click', (e) => {
    const explainBtn = e.target.closest('[data-ona-ai-explain]');
    if (explainBtn) {
      e.preventDefault();
      const targetCase = explainBtn.getAttribute('data-ona-ai-explain') || getCurrentPageCaseId();
      openDrawer(targetCase);
      sendQuery(`Please explain the current status, progress, and next steps for my case ${targetCase || ''}`, targetCase);
    }
  });

  // Expose global controller
  window.OnaAI = {
    open: openDrawer,
    close: closeDrawer,
    ask: sendQuery
  };

  console.log('Ona AI Case Companion successfully initialized.');
})();

