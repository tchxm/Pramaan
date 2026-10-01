import React from "react";
import ReactDOM from "react-dom/client";
import Otp from "./pages/Otp";
import ServerDeal from "./pages/ServerDeal";
import RememberMe from "./pages/RememberMe";
import Terms from "./pages/Terms";
import Hierarchy from "./pages/Hierarchy";
import "./styles.css";

function App() {
  return (
    <div className="page">
      <Otp />
      <ServerDeal expiresAt={Date.now() + 120000} />
      <RememberMe />
      <Terms />
      <Hierarchy />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
