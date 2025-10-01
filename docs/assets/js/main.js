document.addEventListener('DOMContentLoaded', () => {
  // --- 1. THEME SWITCHER --- //
  const themeToggle = document.getElementById('theme-toggle');
  const sidebarToggle = document.getElementById('sidebar-toggle');
  const sidebar = document.getElementById('sidebar');
  const sidebarOverlay = document.getElementById('sidebar-overlay');
  
  // Initialize theme
  const currentTheme = localStorage.getItem('theme') || 'light';
  if (currentTheme === 'dark') {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }

  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      const isDark = document.documentElement.classList.contains('dark');
      if (isDark) {
        document.documentElement.classList.remove('dark');
        localStorage.setItem('theme', 'light');
      } else {
        document.documentElement.classList.add('dark');
        localStorage.setItem('theme', 'dark');
      }
    });
  }

  // --- MOBILE SIDEBAR TOGGLE --- //
  if (sidebarToggle && sidebar && sidebarOverlay) {
    sidebarToggle.addEventListener('click', () => {
      const isHidden = sidebar.classList.contains('-translate-x-full');
      if (isHidden) {
        sidebar.classList.remove('-translate-x-full');
        sidebarOverlay.classList.remove('hidden');
      } else {
        sidebar.classList.add('-translate-x-full');
        sidebarOverlay.classList.add('hidden');
      }
    });

    sidebarOverlay.addEventListener('click', () => {
      sidebar.classList.add('-translate-x-full');
      sidebarOverlay.classList.add('hidden');
    });
  }

  // --- 2. COPY-TO-CLIPBOARD FOR CODE BLOCKS --- //
  document.querySelectorAll('.highlight').forEach(highlightDiv => {
    const codeBlock = highlightDiv.querySelector('pre > code');
    if (!codeBlock) return;

    const copyButton = document.createElement('button');
    copyButton.className = 'copy-btn';
    copyButton.textContent = 'Copy';
    highlightDiv.appendChild(copyButton);

    copyButton.addEventListener('click', () => {
      navigator.clipboard.writeText(codeBlock.innerText).then(() => {
        copyButton.textContent = 'Copied!';
        copyButton.classList.add('copied');
        setTimeout(() => {
          copyButton.textContent = 'Copy';
          copyButton.classList.remove('copied');
        }, 2000);
      }).catch(err => {
        console.error('Failed to copy text: ', err);
        copyButton.textContent = 'Error';
      });
    });
  });

  // --- 3. ACTIVE SIDEBAR LINK HIGHLIGHTING --- //
  const sidebarLinks = document.querySelectorAll('.sidebar-link');
  const sections = document.querySelectorAll('h1[id], h2[id], h3[id]');

  if (sidebarLinks.length > 0 && sections.length > 0) {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const id = entry.target.getAttribute('id');
          sidebarLinks.forEach(link => {
            link.classList.remove('bg-custom-blue-100', 'dark:bg-custom-blue-900/30', 'text-custom-blue-700', 'dark:text-custom-blue-300', 'font-medium');
            if (link.getAttribute('href') === `#${id}`) {
              link.classList.add('bg-custom-blue-100', 'dark:bg-custom-blue-900/30', 'text-custom-blue-700', 'dark:text-custom-blue-300', 'font-medium');
            }
          });
        }
      });
    }, { rootMargin: '-100px 0px -50% 0px' }); // Adjust rootMargin to tune highlighting

    sections.forEach(section => {
      observer.observe(section);
    });
  }
});
