import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { DuetApp } from "@/components/duet/DuetApp";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  if (!ready) {
    return (
      <main className="splash">
        <div>
          <p className="eyebrow">Two chairs</p>
          <h1 className="display mt-2 text-6xl">DUET</h1>
          <p className="mt-3 text-muted">A private table for two.</p>
        </div>
      </main>
    );
  }
  return <DuetApp />;
}
