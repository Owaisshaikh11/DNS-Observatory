/**
 * Shared Framer Motion variant configuration mappings.
 */

// Page-level transition variants
export const pageVariants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0, y: -40 },
  transition: { duration: 0.8, ease: [0.16, 1, 0.3, 1] }
};

// Input error shaking animation mapping
export const inputErrorVariants = {
  shake: { x: [-12, 12, -10, 10, -5, 5, 0] },
  transition: { duration: 0.4 }
};

// Accordion (collapsible panel) vertical expansion variants
export const accordionVariants = {
  initial: { height: 0, opacity: 0 },
  animate: { height: 'auto', opacity: 1 },
  exit: { height: 0, opacity: 0 },
  transition: { duration: 0.2, ease: 'easeInOut' }
};

// Dropdown popup fade-in variants
export const dropdownVariants = {
  initial: { opacity: 0, y: -5 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -5 },
  transition: { duration: 0.12 }
};

// Overlay backdrop fade variants
export const overlayVariants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 }
};

// Slide-out drawer animations (Right to Left)
export const drawerVariants = {
  initial: { x: '100%' },
  animate: { x: 0 },
  exit: { x: '100%' },
  transition: { type: 'spring', damping: 26, stiffness: 220 }
};

// Bento Box card hover animations
export const bentoVariants = {
  initial: { opacity: 0, y: 40 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.6 }
};
