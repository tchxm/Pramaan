interface MobileNavigationProps {
    id: string;
    open: boolean;
    onClose: () => void;
    onNavigate: (to: string) => void;
}
/**
 * Full-viewport mobile nav overlay. Handles the full accessibility
 * checklist from spec Section 9.5: real <button>s, aria-expanded /
 * aria-controls (wired by the caller via `id`), Escape-to-close, a focus
 * trap while open, body scroll lock, and returning focus to the hamburger
 * on close (the caller owns that last step since it owns the button ref).
 */
export default function MobileNavigation({ id, open, onClose, onNavigate }: MobileNavigationProps): import("react").JSX.Element;
export {};
