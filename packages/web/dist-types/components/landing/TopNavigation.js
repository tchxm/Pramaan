import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useId, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import MobileNavigation from "./MobileNavigation.js";
/**
 * Fixed top navigation for the landing page. Desktop shows the full nav +
 * CTA; below `md` it collapses to a hamburger that opens MobileNavigation.
 *
 * NOTE on "How it works" / "Documentation": neither an in-app explanation
 * screen nor a docs site exists yet. Both links scroll to the in-page
 * "#how-it-works" hero section (the blurred intro + typewriter copy) rather
 * than pointing at a route or URL that doesn't exist. See handoff notes.
 */
export default function TopNavigation() {
    const [mobileOpen, setMobileOpen] = useState(false);
    const panelId = useId();
    const hamburgerRef = useRef(null);
    const navigate = useNavigate();
    const closeMobileNav = useCallback(() => {
        setMobileOpen(false);
        window.setTimeout(() => hamburgerRef.current?.focus(), 0);
    }, []);
    const handleMobileNavigate = useCallback((to) => {
        setMobileOpen(false);
        navigate(to);
    }, [navigate]);
    return (_jsxs("header", { className: "fixed inset-x-0 top-0 z-30 px-5 py-4 sm:px-8 sm:py-5", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsxs(Link, { to: "/", className: "[font-family:var(--font-heading)] text-lg tracking-tight text-white sm:text-xl", "aria-label": "PRAMAAN home", children: ["PRAMAAN", _jsx("span", { "aria-hidden": "true", children: "\u2726" })] }), _jsxs("nav", { "aria-label": "Primary", className: "hidden items-center gap-8 text-sm text-white/85 md:flex", children: [_jsx("a", { href: "#how-it-works", className: "transition-colors duration-150 hover:text-white", children: "How it works" }), _jsx(Link, { to: "/verify", className: "transition-colors duration-150 hover:text-white", children: "Evidence" }), _jsx("a", { href: "#how-it-works", className: "transition-colors duration-150 hover:text-white", children: "Documentation" })] }), _jsx("div", { className: "hidden md:block", children: _jsx(Link, { to: "/audit", className: "inline-flex items-center rounded-full border border-black/15 bg-white px-5 py-2 text-sm text-black transition-colors duration-150 hover:bg-black hover:text-white", children: "Start an audit" }) }), _jsxs("button", { ref: hamburgerRef, type: "button", className: "relative z-30 flex h-6 w-6 flex-col items-center justify-center gap-[5px] md:hidden", "aria-label": mobileOpen ? "Close navigation" : "Open navigation", "aria-expanded": mobileOpen, "aria-controls": panelId, onClick: () => setMobileOpen((prev) => !prev), children: [_jsx("span", { className: "block h-[2px] w-6 bg-white transition-transform duration-300 ease-in-out", style: { transform: mobileOpen ? "translateY(7px) rotate(45deg)" : "none" } }), _jsx("span", { className: "block h-[2px] w-6 bg-white transition-opacity duration-300 ease-in-out", style: { opacity: mobileOpen ? 0 : 1 } }), _jsx("span", { className: "block h-[2px] w-6 bg-white transition-transform duration-300 ease-in-out", style: { transform: mobileOpen ? "translateY(-7px) rotate(-45deg)" : "none" } })] })] }), _jsx(MobileNavigation, { id: panelId, open: mobileOpen, onClose: closeMobileNav, onNavigate: handleMobileNavigate })] }));
}
