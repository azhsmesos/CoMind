import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./audio-capture";
import "./index.css";

if (location.hash === "#audio-capture" || location.hash === "#mock-microphone") {
  // The hidden capture renderer exposes startVoiceCapture to the main process.
} else {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
