(() => {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // 1. Automatic tagging for landmark elements that don't have explicit data-aos
  const autoTargets = [
    { selector: '.hero-content', animation: 'fade-right', delay: 0 },
    { selector: '.hero-visual-wrapper', animation: 'fade-left', delay: 100 },
    { selector: '.section-header', animation: 'fade-up', delay: 0 },
    { selector: '.cta-box', animation: 'zoom-in-up', delay: 0 }
  ];

  autoTargets.forEach(({ selector, animation, delay }) => {
    document.querySelectorAll(selector).forEach((el) => {
      if (!el.hasAttribute('data-aos')) {
        el.setAttribute('data-aos', animation);
        if (delay) el.setAttribute('data-aos-delay', String(delay));
      }
    });
  });

  // Automatically stagger grid children
  const gridConfigs = [
    { container: '.feature-grid', items: '.feature', animation: 'fade-up', stagger: 120 },
    { container: '.steps-grid', items: '.step-card', animation: 'fade-up', stagger: 100 },
    { container: '.reassurance-grid', items: '.reassurance-card', animation: 'fade-up', stagger: 80 }
  ];

  gridConfigs.forEach(({ container, items, animation, stagger }) => {
    document.querySelectorAll(container).forEach((grid) => {
      const children = grid.querySelectorAll(items);
      children.forEach((child, idx) => {
        if (!child.hasAttribute('data-aos')) {
          child.setAttribute('data-aos', animation);
          child.setAttribute('data-aos-delay', String(idx * stagger));
        }
      });
    });
  });

  // 2. Interactive Tilt for cards (mouse pointer only)
  const interactiveCards = document.querySelectorAll(
    '.report-preview, .feature, .step-card, .step, .clarity-card, .auth-card, .item, .panel, .card, .case-card, .evidence-card, .side-card, .wizard-card'
  );

  interactiveCards.forEach((card) => {
    card.dataset.motion = 'reveal';
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

  // 3. High Performance IntersectionObserver for Animate On Scroll (AOS)
  const aosElements = document.querySelectorAll('[data-aos]');

  if (reducedMotion || !('IntersectionObserver' in window)) {
    aosElements.forEach((el) => el.classList.add('aos-animate'));
  } else {
    const aosObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('aos-animate');
          observer.unobserve(entry.target);
        }
      });
    }, {
      root: null,
      rootMargin: '0px 0px -40px 0px',
      threshold: 0.08
    });

    aosElements.forEach((el) => aosObserver.observe(el));
  }

  // 4. Support legacy data-motion="reveal"
  if ('IntersectionObserver' in window && !reducedMotion) {
    const observer = new IntersectionObserver((entries, currentObserver) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        currentObserver.unobserve(entry.target);
      });
    }, { threshold: 0.1 });
    document.querySelectorAll('[data-motion="reveal"]').forEach((element) => observer.observe(element));
  } else {
    document.querySelectorAll('[data-motion="reveal"]').forEach((element) => element.classList.add('is-visible'));
  }

  // 5. Tactile button active states
  document.querySelectorAll('.button, .nav-cta, button').forEach((button) => {
    button.addEventListener('pointerdown', () => button.classList.add('is-pressed'));
    button.addEventListener('pointerup', () => button.classList.remove('is-pressed'));
    button.addEventListener('pointerleave', () => button.classList.remove('is-pressed'));
  });
})();
