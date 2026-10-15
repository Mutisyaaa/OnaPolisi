(() => {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const interactiveCards = document.querySelectorAll(
    '.report-preview, .feature, .step, .clarity-card, .auth-card, .item, .panel, .card, .case-card, .evidence-card, .side-card, .wizard-card'
  );

  interactiveCards.forEach((card, index) => {
    card.dataset.motion = 'reveal';
    card.style.transitionDelay = `${Math.min(index * 45, 270)}ms`;
    if (reducedMotion || !window.matchMedia('(pointer: fine)').matches) return;
    card.dataset.tilt = 'true';
    card.addEventListener('pointermove', (event) => {
      const bounds = card.getBoundingClientRect();
      const x = (event.clientX - bounds.left) / bounds.width - 0.5;
      const y = (event.clientY - bounds.top) / bounds.height - 0.5;
      card.style.setProperty('--tilt-x', `${(y * -3).toFixed(2)}deg`);
      card.style.setProperty('--tilt-y', `${(x * 3).toFixed(2)}deg`);
    });
    card.addEventListener('pointerleave', () => {
      card.style.setProperty('--tilt-x', '0deg');
      card.style.setProperty('--tilt-y', '0deg');
    });
  });

  if ('IntersectionObserver' in window && !reducedMotion) {
    const observer = new IntersectionObserver((entries, currentObserver) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        currentObserver.unobserve(entry.target);
      });
    }, { threshold: 0.12 });
    document.querySelectorAll('[data-motion="reveal"]').forEach((element) => observer.observe(element));
  } else {
    document.querySelectorAll('[data-motion="reveal"]').forEach((element) => element.classList.add('is-visible'));
  }

  document.querySelectorAll('.button, .nav-cta, button').forEach((button) => {
    button.addEventListener('pointerdown', () => button.classList.add('is-pressed'));
    button.addEventListener('pointerup', () => button.classList.remove('is-pressed'));
    button.addEventListener('pointerleave', () => button.classList.remove('is-pressed'));
  });
})();
