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

type PartnerConfig = {
  email: string;
  userId: string;
  label: string;
};

const STORAGE_KEY = "daily-counter-state";
const PARTNER_STORAGE_KEY = "daily-counter-partner";
const ENV_PARTNER_USER_ID = import.meta.env.VITE_PARTNER_USER_ID as string | undefined;
const ENV_PARTNER_LABEL = (import.meta.env.VITE_PARTNER_LABEL as string | undefined) || "Partner";
const PARTNER_RESOLVER_URL = import.meta.env.VITE_PARTNER_RESOLVER_URL as string | undefined;

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
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(
    new Date()
  );
  const [historyMonth, setHistoryMonth] = useState<Date>(() =>
    startOfMonth(new Date())
  );
  const [history, setHistory] = useState<Record<string, Counters>>({});
  const [partnerToday, setPartnerToday] = useState<Counters | null>(null);
  const [partnerError, setPartnerError] = useState<string | null>(null);
  const [partnerConfig, setPartnerConfig] = useState<PartnerConfig>(() => {
    if (typeof window !== "undefined") {
      const raw = localStorage.getItem(PARTNER_STORAGE_KEY);
      if (raw) {
        try {
          return JSON.parse(raw) as PartnerConfig;
        } catch {
          // ignore malformed partner data
        }
      }
    }
    return {
      email: "",
      userId: ENV_PARTNER_USER_ID ?? "",
      label: ENV_PARTNER_LABEL,
    };
  });
  const [partnerFormEmail, setPartnerFormEmail] = useState(partnerConfig.email);
  const [partnerFormUserId, setPartnerFormUserId] = useState(partnerConfig.userId);
  const [partnerFormLabel, setPartnerFormLabel] = useState(partnerConfig.label);
  const [partnerSaving, setPartnerSaving] = useState(false);
  const [partnerStatus, setPartnerStatus] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  useEffect(() => {
    localStorage.setItem(PARTNER_STORAGE_KEY, JSON.stringify(partnerConfig));
  }, [partnerConfig]);

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

  // const resetToday = () =>
  //   setState({ date: todayKey(), poop: 0, farts: 0, waterMl: 0 });

  const waterLiters = (state.waterMl / 1000).toFixed(2);
  const selectedKey = selectedDate ? dateKey(selectedDate) : state.date;
  const selectedFromHistory = history[selectedKey];
  const selectedSummary =
    selectedKey === state.date ? state : selectedFromHistory;

  // Supabase session listener
  useEffect(() => {
    const setup = async () => {
      const { data } = await supabase.auth.getSession();
      setSession(data.session);
      setSessionLoading(false);
    };
    setup();
    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, nextSession) => {
        setSession(nextSession);
        setHydrated(false);
      }
    );
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
      const { error } = await supabase.from("daily_metrics").upsert(
        {
          user_id: session.user.id,
          date: state.date,
          water_ml: state.waterMl,
          poop_count: state.poop,
          fart_count: state.farts,
        },
        { onConflict: "user_id,date" }
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

  // Fetch partner's today (optional, requires share + partner user id)
  useEffect(() => {
    const loadPartner = async () => {
      if (!session || !partnerConfig.userId) {
        setPartnerToday(null);
        setPartnerError(null);
        return;
      }
      const today = todayKey();
      const { data, error } = await supabase
        .from("daily_metrics")
        .select("date, water_ml, poop_count, fart_count")
        .eq("user_id", partnerConfig.userId)
        .eq("date", today)
        .maybeSingle();
      if (error) {
        console.error("Failed to load partner data", error);
        setPartnerToday(null);
        setPartnerError("Cannot load partner data (check share/permissions).");
        return;
      }
      setPartnerError(null);
      if (data) {
        setPartnerToday({
          date: data.date,
          waterMl: data.water_ml ?? 0,
          poop: data.poop_count ?? 0,
          farts: data.fart_count ?? 0,
        });
      } else {
        setPartnerToday(null);
      }
    };
    loadPartner();
  }, [session, state.date, partnerConfig.userId]);

  const signOut = async () => {
    try {
      await supabase.auth.signOut({ scope: "local" });
    } catch (error) {
      console.error("Sign out failed", error);
    } finally {
      localStorage.removeItem("supabase.auth.token");
      setSession(null);
      setState(initialState());
    }
  };

  const savePartner = async (event: React.FormEvent) => {
    event.preventDefault();
    setPartnerSaving(true);
    setPartnerError(null);
    setPartnerStatus(null);

    let nextId = partnerFormUserId.trim();
    const nextEmail = partnerFormEmail.trim();
    const nextLabel = partnerFormLabel.trim() || "Partner";

    if (PARTNER_RESOLVER_URL && nextEmail) {
      try {
        const token = session?.access_token;
        const resp = await fetch(PARTNER_RESOLVER_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ email: nextEmail }),
        });
        if (!resp.ok) {
          throw new Error(`Resolver failed (${resp.status})`);
        }
        const json = await resp.json();
        nextId = json.user_id || json.userId || nextId;
        if (!nextId) {
          throw new Error("Resolver did not return user_id");
        }
      } catch (err) {
        console.error("Partner resolver error", err);
        setPartnerError("Could not resolve email to partner ID. Enter user ID manually or fix resolver.");
        setPartnerSaving(false);
        return;
      }
    }

    if (!nextId) {
      setPartnerError("Enter partner user ID (or set a resolver + email).");
      setPartnerSaving(false);
      return;
    }

    setPartnerConfig({ email: nextEmail, userId: nextId, label: nextLabel });
    setPartnerStatus("Partner saved. Make sure they shared access to you.");
    setPartnerSaving(false);
  };

  const clearPartner = () => {
    setPartnerConfig({ email: "", userId: "", label: "Partner" });
    setPartnerFormEmail("");
    setPartnerFormUserId("");
    setPartnerFormLabel("Partner");
    setPartnerStatus(null);
    setPartnerError(null);
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
        <header className="card app-header mb-5">
          <div>
            <h1 className="text-2xl! mb-5! text-center">
              Daily Counter of Your Water, Poop and Farts!
            </h1>
            <p className="muted">
              Sign in to save your logs and keep water, poop, and fart counts
              separate for each account.
            </p>
          </div>
        </header>
        <AuthForm />
        <p className="muted card mt-5!">
          You must sign in to view and log entries. Use the given email/password
          to you.
        </p>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div className="view-tabs">
        <button
          className={`nav__item${
            activeView === "today" ? " nav__item--active" : ""
          }`}
          onClick={() => setActiveView("today")}
        >
          Today
        </button>
        <button
          className={`nav__item${
            activeView === "history" ? " nav__item--active" : ""
          }`}
          onClick={() => setActiveView("history")}
        >
          History
        </button>
      </div>
      <div className="card auth-bar mt-4!">
        <div>
          <p className="label">Signed in</p>
          <p className="muted">{session.user.email}</p>
        </div>
        <button className="ghost" onClick={signOut}>
          Sign out
        </button>
      </div>
      <header className="card app-header mb-4! mt-4!">
        <div className="pill">Today · {displayDate}</div>
        <section className="card summary-card">
          <p className="label">Today&apos;s totals</p>
          <div className="summary-grid">
            <div className="pill font-bold text-lg!">
              Water: {waterLiters} L
            </div>
            <div className="pill font-bold text-lg!">Poop: {state.poop}</div>
            <div className="pill font-bold text-lg!">Farts: {state.farts}</div>
          </div>
          {partnerConfig.userId && (
            <div className="summary-grid">
              <div className="pill">{partnerConfig.label} Water: {(partnerToday?.waterMl ?? 0) / 1000} L</div>
              <div className="pill">{partnerConfig.label} Poop: {partnerToday?.poop ?? 0}</div>
              <div className="pill">{partnerConfig.label} Farts: {partnerToday?.farts ?? 0}</div>
              {partnerError && <div className="pill">{partnerError}</div>}
              {!partnerError && !partnerToday && (
                <div className="pill">No data for {partnerConfig.label} today.</div>
              )}
            </div>
          )}
        </section>
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
          <section className="card auth-form mt-3!">
            <p className="label">Partner access</p>
            <p className="muted">
              Enter partner email (resolver) or user ID so you can see their today totals. They also need to share their data with you.
            </p>
            <div className="auth-inputs">
              <input
                type="email"
                placeholder="partner@example.com (optional)"
                value={partnerFormEmail}
                onChange={(e) => setPartnerFormEmail(e.target.value)}
              />
              <input
                type="text"
                placeholder="Partner user ID"
                value={partnerFormUserId}
                onChange={(e) => setPartnerFormUserId(e.target.value)}
              />
              <input
                type="text"
                placeholder="Label"
                value={partnerFormLabel}
                onChange={(e) => setPartnerFormLabel(e.target.value)}
              />
            </div>
            <div className="actions-grid">
              <button onClick={savePartner} disabled={partnerSaving} type="button">
                {partnerSaving ? "Saving..." : "Save partner"}
              </button>
              <button className="ghost" onClick={clearPartner} type="button">
                Clear
              </button>
            </div>
            {partnerStatus && <p className="pill">{partnerStatus}</p>}
            {partnerError && <p className="pill">{partnerError}</p>}
            {!PARTNER_RESOLVER_URL && (
              <p className="muted">
                Tip: add VITE_PARTNER_RESOLVER_URL to resolve email → user ID via an Edge Function.
              </p>
            )}
          </section>
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
                <div className="pill">
                  Water: {(selectedSummary.waterMl / 1000).toFixed(2)} L
                </div>
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
