import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/noto-sans-jp/wght.css";
import "@fontsource-variable/noto-sans-mono/wght.css";
import "@livetoon/slide-renderer-react/styles.css";
import "./studio.css";
import { App } from "./app.js";

const root = document.getElementById("root");
if (!root) throw new Error("Studio root element is missing.");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
