import { useEffect, useMemo, useState } from "react";
import FartCounter from "./components/FartCounter";
import Header from "./components/Header";
import PoopCounter from "./components/PoopCounter";
import WaterCounter from "./components/WaterCounter";

type Counters = {
  date: string;
  poop: number;
  farts: number;
  waterMl: number;
};

const STORAGE_KEY = "daily-counter-state";

const todayKey = () => new Date().toISOString().slice(0, 10);

const initialState = (): Counters => {
  if (typeof window !== "undefined") {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Counters;
        if (parsed.date === todayKey()) {
          return parsed;
        }
      } catch {
        // ignore malformed stored data
      }
    }
  }
  return { date: todayKey(), poop: 0, farts: 0, waterMl: 0 };
};

function App() {
  const [state, setState] = useState<Counters>(initialState);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  const displayDate = useMemo(() => {
    const date = new Date(state.date);
    return date.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  }, [state.date]);

  const adjust = (field: "poop" | "farts" | "waterMl", delta: number) => {
    setState((prev) => {
      const next = { ...prev };
      next[field] = Math.max(0, next[field] + delta);
      next.date = todayKey();
      return next;
    });
  };

  const resetToday = () =>
    setState({ date: todayKey(), poop: 0, farts: 0, waterMl: 0 });

  const waterLiters = (state.waterMl / 1000).toFixed(2);

  const [active, setActive] = useState<"water" | "poop" | "farts">("water");

  return (
    <div className="app-shell">
      <Header active={active} onSelect={setActive} />
      <header className="card app-header">
        <div className="pill">Today · {displayDate}</div>
        <div>
          <h1>Daily Counter</h1>
          <p className="muted">
            Quick taps to log water, poop, and farts—keeps today saved on your
            phone.
          </p>
        </div>
        <button onClick={resetToday}>Reset today</button>
      </header>

      <main>
        {active === "water" && (
          <WaterCounter
            waterMl={state.waterMl}
            displayLiters={waterLiters}
            onAdd={(amount) => adjust("waterMl", amount)}
            onRemove={(amount) => adjust("waterMl", -amount)}
          />
        )}

        {active === "poop" && (
          <PoopCounter
            count={state.poop}
            onAdd={() => adjust("poop", 1)}
            onRemove={() => adjust("poop", -1)}
          />
        )}

        {active === "farts" && (
          <FartCounter
            count={state.farts}
            onAdd={() => adjust("farts", 1)}
            onRemove={() => adjust("farts", -1)}
          />
        )}
      </main>
    </div>
  );
}

export default App;
