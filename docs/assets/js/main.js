document.addEventListener('DOMContentLoaded', () => {
  // --- 1. THEME SWITCHER --- //
  const themeToggle = document.getElementById('theme-toggle');
  const currentTheme = localStorage.getItem('theme') || 'light';
  document.documentElement.setAttribute('data-theme', currentTheme);

  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      let newTheme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', newTheme);
      localStorage.setItem('theme', newTheme);
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
  const sidebarLinks = document.querySelectorAll('.sidebar-nav a');
  const sections = document.querySelectorAll('h1[id], h2[id], h3[id]');

  if (sidebarLinks.length > 0 && sections.length > 0) {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const id = entry.target.getAttribute('id');
          sidebarLinks.forEach(link => {
            link.classList.remove('active');
            if (link.getAttribute('href') === `#${id}`) {
              link.classList.add('active');
            }
          });
        }
      });
    }, { rootMargin: '-100px 0px -50% 0px' }); // Adjust rootMargin to tune highlighting

    sections.forEach(section => {
      observer.observe(section);
    });
  }
  
  // --- 4. MOBILE SIDEBAR TOGGLE --- //
  const sidebarToggle = document.getElementById('sidebar-toggle');
  if (sidebarToggle) {
      sidebarToggle.addEventListener('click', () => {
          document.body.classList.toggle('sidebar-open');
      });
  }
});
