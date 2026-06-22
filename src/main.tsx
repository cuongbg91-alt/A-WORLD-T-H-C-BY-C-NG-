import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Ngăn chặn các thông báo lỗi, log cảnh báo hoặc thông tin phiền toái liên quan đến HMR WebSocket, CONNECTED, Build, Render End trong Sandbox
if (typeof window !== "undefined") {
  const shouldSuppressLog = (msg: string): boolean => {
    const trimmed = msg.trim();
    const lower = trimmed.toLowerCase();
    return (
      lower.includes("websocket") ||
      lower.includes("hmr") ||
      lower.includes("[vite]") ||
      lower.includes("failed to connect to websocket") ||
      lower.includes("connected") ||
      lower.includes("build") ||
      lower.includes("render start") ||
      lower.includes("render end") ||
      lower.includes("debug") ||
      lower.includes("connecting...") ||
      lower.includes("closed without opened") ||
      lower.includes("gemini fallback window") ||
      lower.includes("gọi mô hình gemini")
    );
  };

  window.addEventListener("unhandledrejection", (event) => {
    const reasonStr = event.reason ? String(event.reason.message || event.reason) : "";
    if (shouldSuppressLog(reasonStr)) {
      event.preventDefault();
      event.stopPropagation();
    }
  });

  window.addEventListener("error", (event) => {
    const errorStr = event.message || "";
    if (shouldSuppressLog(errorStr)) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);

  const wrapConsole = (originalFunc: (...args: any[]) => void) => {
    return (...args: any[]) => {
      const msg = args.map(arg => {
        try {
          return typeof arg === "object" ? JSON.stringify(arg) : String(arg);
        } catch (_) {
          return String(arg);
        }
      }).join(" ");
      if (shouldSuppressLog(msg)) {
        return;
      }
      originalFunc(...args);
    };
  };

  console.log = wrapConsole(console.log);
  console.error = wrapConsole(console.error);
  console.warn = wrapConsole(console.warn);
  console.info = wrapConsole(console.info);
  console.debug = wrapConsole(console.debug);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
