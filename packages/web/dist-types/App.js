import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
import { Routes, Route } from "react-router-dom";
import LandingPage from "./components/landing/LandingPage.js";
function Placeholder({ name }) {
    return _jsxs("div", { style: { padding: 24 }, children: [name, " \u2014 not implemented yet."] });
}
export default function App() {
    return (_jsxs(Routes, { children: [_jsx(Route, { path: "/", element: _jsx(LandingPage, {}) }), _jsx(Route, { path: "/audit", element: _jsx(Placeholder, { name: "Start audit (S1)" }) }), _jsx(Route, { path: "/audit/:id", element: _jsx(Placeholder, { name: "Workspace (S2)" }) }), _jsx(Route, { path: "/audit/:id/outcome", element: _jsx(Placeholder, { name: "Outcome (S4)" }) }), _jsx(Route, { path: "/verify", element: _jsx(Placeholder, { name: "Pack verifier (S5)" }) })] }));
}
