import { jsx as _jsx } from "react/jsx-runtime";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.js";
import "./styles/tailwind.css";
import "./styles/global.css";
const rootEl = document.getElementById("root");
if (!rootEl) {
    throw new Error("#root element not found");
}
createRoot(rootEl).render(_jsx(StrictMode, { children: _jsx(BrowserRouter, { children: _jsx(App, {}) }) }));
