import { useEffect, useMemo, useState } from "react";
import { DayPicker } from "react-day-picker";
import type { Session } from "@supabase/supabase-js";
import "react-day-picker/dist/style.css";
import AuthForm from "./components/AuthForm";
import FartCounter from "./components/FartCounter";
import PoopCounter from "./components/PoopCounter";
import WaterCounter from "./components/WaterCounter";
import supabase from "./utils/supabase";

type Counters = {
  date: string;
  poop: number;
  farts: number;
  waterMl: number;
};

const STORAGE_KEY = "daily-counter-state";

const dateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const todayKey = () => dateKey(new Date());

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
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [hydrated, setHydrated] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<"today" | "history">("today");
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date());
  const [historyMonth, setHistoryMonth] = useState<Date>(() => startOfMonth(new Date()));
  const [history, setHistory] = useState<Record<string, Counters>>({});

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
  const selectedKey = selectedDate ? dateKey(selectedDate) : state.date;
  const selectedFromHistory = history[selectedKey];
  const selectedSummary = selectedKey === state.date ? state : selectedFromHistory;

  // Supabase session listener
  useEffect(() => {
    const setup = async () => {
      const { data } = await supabase.auth.getSession();
      setSession(data.session);
      setSessionLoading(false);
    };
    setup();
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setHydrated(false);
    });
    return () => {
      listener?.subscription.unsubscribe();
    };
  }, []);

  // Load today's data for the logged-in user
  useEffect(() => {
    const load = async () => {
      if (!session) {
        setState(initialState());
        setHydrated(true);
        return;
      }
      setHydrated(false);
      setSyncError(null);
      const { data, error } = await supabase
        .from("daily_metrics")
        .select("date, water_ml, poop_count, fart_count")
        .eq("user_id", session.user.id)
        .eq("date", todayKey())
        .maybeSingle();
      if (error) {
        console.error("Failed to load data", error);
        setSyncError("Could not load latest data (using local values).");
        setState(initialState());
      } else if (data) {
        setState({
          date: data.date,
          waterMl: data.water_ml ?? 0,
          poop: data.poop_count ?? 0,
          farts: data.fart_count ?? 0,
        });
      } else {
        // No row yet for today
        setState({ date: todayKey(), poop: 0, farts: 0, waterMl: 0 });
      }
      setHydrated(true);
    };
    load();
  }, [session]);

  // Persist to Supabase when logged in and hydrated
  useEffect(() => {
    const sync = async () => {
      if (!session || !hydrated) return;
      const { error } = await supabase
        .from("daily_metrics")
        .upsert(
          {
            user_id: session.user.id,
            date: state.date,
            water_ml: state.waterMl,
            poop_count: state.poop,
            fart_count: state.farts,
          },
          { onConflict: "user_id,date" },
        );
      if (error) {
        console.error("Failed to sync data", error);
        setSyncError("Saving to Supabase failed (kept locally).");
      } else {
        setSyncError(null);
        setHistory((prev) => ({
          ...prev,
          [state.date]: { ...state },
        }));
      }
    };
    sync();
  }, [state, session, hydrated]);

  // Fetch month history
  useEffect(() => {
    const loadMonth = async () => {
      if (!session) {
        setHistory({});
        return;
      }
      const { start, end } = monthRange(historyMonth);
      const { data, error } = await supabase
        .from("daily_metrics")
        .select("date, water_ml, poop_count, fart_count")
        .eq("user_id", session.user.id)
        .gte("date", start)
        .lte("date", end);
      if (error) {
        console.error("Failed to load history", error);
        return;
      }
      const next: Record<string, Counters> = {};
      data?.forEach((row) => {
        next[row.date] = {
          date: row.date,
          waterMl: row.water_ml ?? 0,
          poop: row.poop_count ?? 0,
          farts: row.fart_count ?? 0,
        };
      });
      setHistory(next);
    };
    loadMonth();
  }, [historyMonth, session]);

  const signOut = async () => {
    await supabase.auth.signOut();
    setSession(null);
    setState(initialState());
  };

  if (sessionLoading) {
    return (
      <div className="app-shell">
        <div className="card">
          <p className="muted">Checking session…</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="app-shell">
        <header className="card app-header">
          <div className="pill">Welcome</div>
          <div>
            <h1>Daily Counter of Your Water, Poop and Farts!</h1>
            <p className="muted">
              Sign in to save your logs and keep water/poop/fart counts separate for each account.
            </p>
          </div>
        </header>
        <AuthForm />
        <p className="muted card">You must sign in to view and log entries.</p>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div className="view-tabs">
        <button
          className={`nav__item${activeView === "today" ? " nav__item--active" : ""}`}
          onClick={() => setActiveView("today")}
        >
          Today
        </button>
        <button
          className={`nav__item${activeView === "history" ? " nav__item--active" : ""}`}
          onClick={() => setActiveView("history")}
        >
          History
        </button>
      </div>
      <div className="card auth-bar">
        <div>
          <p className="label">Signed in</p>
          <p className="muted">{session.user.email}</p>
        </div>
        <button className="ghost" onClick={signOut}>
          Sign out
        </button>
      </div>
      <header className="card app-header">
        <div className="pill">Today · {displayDate}</div>
        <div>
          <h1>Daily Counter of Your Water, Poop and Farts!</h1>
          <p className="muted">
            Quick taps to log water, poop, and farts—keeps today saved on your
            phone.
          </p>
        </div>
        <button onClick={resetToday}>Reset today</button>
      </header>

      {activeView === "today" && (
        <main>
          <WaterCounter
            waterMl={state.waterMl}
            displayLiters={waterLiters}
            onAdd={(amount) => adjust("waterMl", amount)}
            onRemove={(amount) => adjust("waterMl", -amount)}
          />

          <PoopCounter
            count={state.poop}
            onAdd={() => adjust("poop", 1)}
            onRemove={() => adjust("poop", -1)}
          />

          <FartCounter
            count={state.farts}
            onAdd={() => adjust("farts", 1)}
            onRemove={() => adjust("farts", -1)}
          />
        </main>
      )}

      {activeView === "history" && (
        <main>
          <section className="card">
            <p className="label">Pick a date</p>
            <DayPicker
              mode="single"
              selected={selectedDate}
              onSelect={(day) => setSelectedDate(day ?? undefined)}
              month={historyMonth}
              onMonthChange={(next) => setHistoryMonth(startOfMonth(next))}
              showOutsideDays
              weekStartsOn={1}
              modifiers={{
                hasData: Object.keys(history).map((d) => dateFromKey(d)),
              }}
              modifiersClassNames={{
                hasData: "has-data",
              }}
            />
          </section>
          <section className="card tracker">
            <p className="label">Selected day</p>
            <h2>{selectedKey}</h2>
            {selectedSummary ? (
              <div className="summary-grid">
                <div className="pill">Water: {(selectedSummary.waterMl / 1000).toFixed(2)} L</div>
                <div className="pill">Poop: {selectedSummary.poop}</div>
                <div className="pill">Farts: {selectedSummary.farts}</div>
              </div>
            ) : (
              <p className="muted">No data logged for this day yet.</p>
            )}
          </section>
        </main>
      )}
      {syncError && <p className="pill">{syncError}</p>}
    </div>
  );
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function monthRange(month: Date) {
  const start = dateKey(new Date(month.getFullYear(), month.getMonth(), 1));
  const end = dateKey(new Date(month.getFullYear(), month.getMonth() + 1, 0));
  return { start, end };
}

function dateFromKey(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, (month ?? 1) - 1, day ?? 1);
}

export default App;
