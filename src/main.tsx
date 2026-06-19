import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// StrictMode intentionally omitted: it double-invokes effects in dev, and
// TerminalPane's mount effect spawns a real `claude` PTY process. With no
// pty_kill command yet (M1), a double-fire would leak a second process per
// pane. Revisit and restore StrictMode once a pty_kill + pane lifecycle exists.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<App />);
