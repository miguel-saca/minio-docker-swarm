document.addEventListener('DOMContentLoaded', () => {
  // --- 1. ENHANCED THEME SWITCHER --- //
  const themeToggle = document.getElementById('theme-toggle');
  const sidebarToggle = document.getElementById('sidebar-toggle');
  const sidebar = document.getElementById('sidebar');
  const sidebarOverlay = document.getElementById('sidebar-overlay');
  
  // Theme is already initialized by the inline script in <head>
  // This ensures no flash of unstyled content
  
  // Function to handle all theme-dependent updates
  function updateThemeElements(theme) {
    // Update data-theme attribute for CSS and SVG styling
    document.documentElement.setAttribute('data-theme', theme);
    
    // Update theme-aware SVGs
    document.querySelectorAll('.theme-aware-svg').forEach(svg => {
      // Force SVG to re-evaluate its styling by triggering a repaint
      svg.style.colorScheme = theme === 'dark' ? 'dark' : 'light';
      
      // For SVGs that need different sources per theme (if implemented later)
      const lightSrc = svg.getAttribute('data-theme-src-light');
      const darkSrc = svg.getAttribute('data-theme-src-dark');
      
      if (lightSrc && darkSrc && lightSrc !== darkSrc) {
        svg.src = theme === 'dark' ? darkSrc : lightSrc;
      }
    });
    
    // Update Prism.js syntax highlighting
    setTimeout(() => {
      if (window.Prism) {
        window.Prism.highlightAll();
      }
    }, 50);
    
    // Dispatch custom event for other components that need to respond
    window.dispatchEvent(new CustomEvent('themeChange', {
      detail: { theme: theme, source: 'manual' }
    }));
  }

  // Handle manual theme toggle
  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      const isDark = document.documentElement.classList.contains('dark');
      const newTheme = isDark ? 'light' : 'dark';
      
      if (isDark) {
        document.documentElement.classList.remove('dark');
      } else {
        document.documentElement.classList.add('dark');
      }
      
      localStorage.setItem('theme', newTheme);
      updateThemeElements(newTheme);
    });
  }
  
  // Listen for system theme changes (handled by inline script) and other theme changes
  window.addEventListener('themeChange', (e) => {
    const { theme, source } = e.detail;
    if (source === 'system') {
      updateThemeElements(theme);
    }
  });
  
  // Initial theme update for any elements that need it
  const currentTheme = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
  updateThemeElements(currentTheme);

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

  // --- 2. ENHANCED SYNTAX HIGHLIGHTING & COPY-TO-CLIPBOARD --- //
  
  // Function to detect language from code block classes
  function detectLanguage(codeElement) {
    const classes = codeElement.className || '';
    const langMatch = classes.match(/language-(\w+)/);
    return langMatch ? langMatch[1] : '';
  }
  
  // Function to setup code blocks with enhanced features
  function setupCodeBlocks() {
    document.querySelectorAll('.highlight').forEach(highlightDiv => {
      const codeBlock = highlightDiv.querySelector('pre > code');
      if (!codeBlock) return;

      // Detect and set language attribute for styling
      const language = detectLanguage(codeBlock);
      if (language) {
        highlightDiv.setAttribute('data-language', language);
        codeBlock.classList.add(`language-${language}`);
      }

      // Find existing copy button and attach event listener
      const copyButton = highlightDiv.querySelector('.copy-btn');
      if (copyButton && !copyButton.hasAttribute('data-listener-attached')) {
        // Mark button as having listener attached to avoid duplicate listeners
        copyButton.setAttribute('data-listener-attached', 'true');
        
        // Update button with proper SVG icon if it just has text
        if (copyButton.textContent.trim() === 'Copy') {
          copyButton.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path fill-rule="evenodd" d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 010 1.5h-1.5a.25.25 0 00-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 00.25-.25v-1.5a.75.75 0 011.5 0v1.5A1.75 1.75 0 019.25 16h-7.5A1.75 1.75 0 010 14.25v-7.5z"></path>
              <path fill-rule="evenodd" d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0114.25 11h-7.5A1.75 1.75 0 015 9.25v-7.5zm1.75-.25a.25.25 0 00-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 00.25-.25v-7.5a.25.25 0 00-.25-.25h-7.5z"></path>
            </svg>
          `;
        }
        
        copyButton.title = 'Copy to clipboard';

        copyButton.addEventListener('click', () => {
          const textToCopy = codeBlock.textContent || codeBlock.innerText;
          navigator.clipboard.writeText(textToCopy).then(() => {
            copyButton.innerHTML = `
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                <path fill-rule="evenodd" d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z"></path>
              </svg>
            `;
            copyButton.classList.add('copied');
            copyButton.title = 'Copied!';
            setTimeout(() => {
              copyButton.innerHTML = `
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                  <path fill-rule="evenodd" d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 010 1.5h-1.5a.25.25 0 00-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 00.25-.25v-1.5a.75.75 0 011.5 0v1.5A1.75 1.75 0 019.25 16h-7.5A1.75 1.75 0 010 14.25v-7.5z"></path>
                  <path fill-rule="evenodd" d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0114.25 11h-7.5A1.75 1.75 0 015 9.25v-7.5zm1.75-.25a.25.25 0 00-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 00.25-.25v-7.5a.25.25 0 00-.25-.25h-7.5z"></path>
                </svg>
              `;
              copyButton.classList.remove('copied');
              copyButton.title = 'Copy to clipboard';
            }, 2000);
          }).catch(err => {
            console.error('Failed to copy text: ', err);
            copyButton.innerHTML = '✗';
            copyButton.title = 'Copy failed';
            setTimeout(() => {
              copyButton.innerHTML = `
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                  <path fill-rule="evenodd" d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 010 1.5h-1.5a.25.25 0 00-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 00.25-.25v-1.5a.75.75 0 011.5 0v1.5A1.75 1.75 0 019.25 16h-7.5A1.75 1.75 0 010 14.25v-7.5z"></path>
                  <path fill-rule="evenodd" d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0114.25 11h-7.5A1.75 1.75 0 015 9.25v-7.5zm1.75-.25a.25.25 0 00-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 00.25-.25v-7.5a.25.25 0 00-.25-.25h-7.5z"></path>
                </svg>
              `;
              copyButton.title = 'Copy to clipboard';
            }, 2000);
          });
        });
      }
    });
  }
  
  // Initialize code blocks
  setupCodeBlocks();
  
  // Re-run setup when Prism finishes highlighting (for dynamically loaded content)
  if (window.Prism) {
    window.Prism.hooks.add('complete', setupCodeBlocks);
  }

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
  
  // --- 4. PRISM.JS CONFIGURATION --- //
  if (window.Prism) {
    // Configure Prism autoloader
    window.Prism.plugins.autoloader.languages_path = 'https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/';
    
    // Highlight all code blocks on load
    window.Prism.highlightAll();
  }
  
  // --- 5. ACCESSIBILITY ENHANCEMENTS --- //
  
  // Update ARIA labels based on current theme
  function updateThemeAriaLabels() {
    const currentTheme = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
    const toggleButton = document.getElementById('theme-toggle');
    
    if (toggleButton) {
      const newLabel = currentTheme === 'dark' 
        ? 'Switch to light theme' 
        : 'Switch to dark theme';
      toggleButton.setAttribute('aria-label', newLabel);
    }
  }
  
  // Initialize ARIA labels
  updateThemeAriaLabels();
  
  // Update ARIA labels when theme changes
  window.addEventListener('themeChange', updateThemeAriaLabels);
  
  // --- 6. PERFORMANCE OPTIMIZATIONS --- //
  
  // Preload theme-aware assets based on user's preference
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const storedTheme = localStorage.getItem('theme') || (prefersDark ? 'dark' : 'light');
  
  // You can add preloading logic here for theme-specific assets if needed
  
});
