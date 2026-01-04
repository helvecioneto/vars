/**
 * VARS Landing Page - Interactive Scripts
 */

document.addEventListener('DOMContentLoaded', function () {
    // Initialize AOS (Animate On Scroll)
    AOS.init({
        duration: 800,
        easing: 'ease-out-cubic',
        once: true,
        offset: 100
    });

    // Navigation functionality
    initNavigation();

    // Image gallery
    initGallery();

    // Smooth scroll for anchor links
    initSmoothScroll();

    // Parallax effects
    initParallax();
});

/**
 * Navigation functionality
 */
function initNavigation() {
    const navbar = document.getElementById('navbar');
    const navToggle = document.getElementById('nav-toggle');
    const navMenu = document.getElementById('nav-menu');

    // Navbar scroll effect
    window.addEventListener('scroll', function () {
        if (window.scrollY > 50) {
            navbar.classList.add('scrolled');
        } else {
            navbar.classList.remove('scrolled');
        }
    });

    // Mobile menu toggle
    navToggle.addEventListener('click', function () {
        navMenu.classList.toggle('active');

        // Animate hamburger
        const spans = navToggle.querySelectorAll('span');
        if (navMenu.classList.contains('active')) {
            spans[0].style.transform = 'rotate(45deg) translate(5px, 5px)';
            spans[1].style.opacity = '0';
            spans[2].style.transform = 'rotate(-45deg) translate(5px, -5px)';
        } else {
            spans[0].style.transform = '';
            spans[1].style.opacity = '';
            spans[2].style.transform = '';
        }
    });

    // Close mobile menu when clicking a link
    const navLinks = navMenu.querySelectorAll('.nav-link');
    navLinks.forEach(link => {
        link.addEventListener('click', function () {
            navMenu.classList.remove('active');
            const spans = navToggle.querySelectorAll('span');
            spans[0].style.transform = '';
            spans[1].style.opacity = '';
            spans[2].style.transform = '';
        });
    });
}

/**
 * Image gallery functionality
 */
function initGallery() {
    const thumbnails = document.querySelectorAll('.thumbnail');
    const mainImg = document.getElementById('gallery-main-img');
    const caption = document.getElementById('gallery-caption');

    if (!thumbnails.length || !mainImg) return;

    thumbnails.forEach(thumb => {
        thumb.addEventListener('click', function () {
            const imgSrc = this.dataset.img;
            const captionText = this.dataset.caption;

            // Update active state
            thumbnails.forEach(t => t.classList.remove('active'));
            this.classList.add('active');

            // Fade transition
            mainImg.style.opacity = '0';

            setTimeout(() => {
                mainImg.src = imgSrc;
                mainImg.alt = captionText;
                caption.textContent = captionText;
                mainImg.style.opacity = '1';
            }, 200);
        });
    });

    // Auto-rotate gallery
    let currentIndex = 0;
    const autoRotate = setInterval(() => {
        if (document.hidden) return; // Don't rotate when tab is hidden

        currentIndex = (currentIndex + 1) % thumbnails.length;
        thumbnails[currentIndex].click();
    }, 5000);

    // Stop auto-rotate on manual interaction
    thumbnails.forEach(thumb => {
        thumb.addEventListener('click', () => clearInterval(autoRotate));
    });
}

/**
 * Smooth scroll for anchor links
 */
function initSmoothScroll() {
    const links = document.querySelectorAll('a[href^="#"]');

    links.forEach(link => {
        link.addEventListener('click', function (e) {
            const targetId = this.getAttribute('href');

            if (targetId === '#') return;

            const target = document.querySelector(targetId);

            if (target) {
                e.preventDefault();

                const navHeight = document.getElementById('navbar').offsetHeight;
                const targetPosition = target.getBoundingClientRect().top + window.pageYOffset - navHeight;

                window.scrollTo({
                    top: targetPosition,
                    behavior: 'smooth'
                });
            }
        });
    });
}

/**
 * Parallax effects
 */
function initParallax() {
    const heroGradient = document.querySelector('.hero-gradient');
    const heroPattern = document.querySelector('.hero-pattern');
    const missionPattern = document.querySelector('.mission-pattern');

    let ticking = false;

    window.addEventListener('scroll', function () {
        if (!ticking) {
            window.requestAnimationFrame(function () {
                const scrollY = window.scrollY;

                // Hero parallax
                if (heroGradient && scrollY < window.innerHeight) {
                    heroGradient.style.transform = `translateX(-50%) translateY(${scrollY * 0.3}px)`;
                }

                if (heroPattern && scrollY < window.innerHeight) {
                    heroPattern.style.transform = `translateY(${scrollY * 0.1}px)`;
                }

                // Mission section parallax
                if (missionPattern) {
                    const missionSection = document.querySelector('.mission');
                    if (missionSection) {
                        const rect = missionSection.getBoundingClientRect();
                        if (rect.top < window.innerHeight && rect.bottom > 0) {
                            const progress = (window.innerHeight - rect.top) / (window.innerHeight + rect.height);
                            missionPattern.style.transform = `translateY(${progress * 50}px)`;
                        }
                    }
                }

                ticking = false;
            });

            ticking = true;
        }
    });
}

/**
 * Detect user's OS for download section
 */
function detectOS() {
    const userAgent = navigator.userAgent.toLowerCase();

    if (userAgent.includes('win')) return 'windows';
    if (userAgent.includes('mac')) return 'macos';
    if (userAgent.includes('linux')) return 'linux';

    return null;
}

// Highlight recommended download based on OS
document.addEventListener('DOMContentLoaded', function () {
    const os = detectOS();

    if (os) {
        const downloadCards = document.querySelectorAll('.download-card');
        downloadCards.forEach(card => {
            if (card.querySelector(`.download-icon.${os}`)) {
                card.style.borderColor = 'var(--accent)';
                card.style.boxShadow = '0 0 40px rgba(139, 92, 246, 0.2)';
            }
        });
    }
});

/**
 * Intersection Observer for scroll-triggered animations
 */
function initScrollAnimations() {
    const observerOptions = {
        root: null,
        rootMargin: '0px',
        threshold: 0.1
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                observer.unobserve(entry.target);
            }
        });
    }, observerOptions);

    const animatedElements = document.querySelectorAll('[data-animate]');
    animatedElements.forEach(el => observer.observe(el));
}

// Typing effect for code window (optional enhancement)
function typeCode() {
    const codeElement = document.querySelector('.code-body code');
    if (!codeElement) return;

    const originalHTML = codeElement.innerHTML;
    const text = codeElement.textContent;

    // Only run typing effect if in viewport
    const observer = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting) {
            // Typing animation could go here
            // For performance, we skip on mobile
            observer.disconnect();
        }
    });

    observer.observe(codeElement);
}
