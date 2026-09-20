import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ScreenshotPicker } from "./components/ScreenshotPicker";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {location.hash === "#capture" ? <ScreenshotPicker /> : <App />}
  </React.StrictMode>,
);
