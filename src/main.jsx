import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import PublicBookingPlaceholder from "./PublicBookingPlaceholder.jsx";
import { registerServiceWorker } from "./registerServiceWorker.js";

function readRoute() {
  return window.location.hash === "#/turnos" ? "turnos" : "interno";
}

function RootRouter() {
  const [route, setRoute] = useState(readRoute);

  useEffect(() => {
    const onHashChange = () => setRoute(readRoute());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  return route === "turnos" ? <PublicBookingPlaceholder /> : <App />;
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <RootRouter />
  </React.StrictMode>
);

registerServiceWorker();