import { TerminalPane } from "./components/TerminalPane";

// TEMP for M1: a real dir the owner has. M3 makes this user-chosen.
const CWD = "/Users/theerametsaengsin/Work/mee-tang/app";

export default function App() {
  return (
    <div style={{ position: "fixed", inset: 0, background: "#1e1e1e", padding: 8 }}>
      <TerminalPane paneId="pane-1" cwd={CWD} />
    </div>
  );
}
