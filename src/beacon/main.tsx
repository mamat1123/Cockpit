import React from "react";
import ReactDOM from "react-dom/client";
import { Beacon } from "./Beacon";

ReactDOM.createRoot(document.getElementById("beacon-root")!).render(
  <React.StrictMode><Beacon /></React.StrictMode>,
);
