import React from "react";
import ReactDOM from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import "@fontsource/baloo-2/600.css";
import "@fontsource/baloo-2/700.css";
import "@fontsource/baloo-2/devanagari-600.css";
import "@fontsource/baloo-2/devanagari-700.css";
import "@fontsource/palanquin/400.css";
import "@fontsource/palanquin/500.css";
import "@fontsource/palanquin/600.css";
import "@fontsource/palanquin/devanagari-400.css";
import "@fontsource/palanquin/devanagari-500.css";
import "@fontsource/palanquin/devanagari-600.css";
import "@fontsource/kalam/400.css";
import "@fontsource/kalam/700.css";
import App from "./App";
import "./styles.css";

registerSW({ immediate: true });

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode><App /></React.StrictMode>,
);
