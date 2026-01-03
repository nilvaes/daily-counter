import { useEffect, useMemo, useState } from "react";
import { DayPicker } from "react-day-picker";
import type { Session } from "@supabase/supabase-js";
import "react-day-picker/dist/style.css";
import AuthForm from "./components/AuthForm";
import FartCounter from "./components/FartCounter";
import PoopCounter from "./components/PoopCounter";
import WaterCounter from "./components/WaterCounter";
import supabase from "./utils/supabase";
import { tr } from "react-day-picker/locale";

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
const ENV_PARTNER_USER_ID = import.meta.env.VITE_PARTNER_USER_ID as
  | string
  | undefined;
const ENV_PARTNER_LABEL =
  (import.meta.env.VITE_PARTNER_LABEL as string | undefined) || "Eş";
const PARTNER_RESOLVER_URL = import.meta.env.VITE_PARTNER_RESOLVER_URL as
  | string
  | undefined;

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
  const [partnerFormUserId, setPartnerFormUserId] = useState(
    partnerConfig.userId
  );
  const [partnerFormLabel, setPartnerFormLabel] = useState(partnerConfig.label);
  const [partnerSaving, setPartnerSaving] = useState(false);
  const [partnerStatus, setPartnerStatus] = useState<string | null>(null);
  const [partnerLoadedFromServer, setPartnerLoadedFromServer] = useState(false);
  const [partnerFormOpen, setPartnerFormOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  useEffect(() => {
    localStorage.setItem(PARTNER_STORAGE_KEY, JSON.stringify(partnerConfig));
  }, [partnerConfig]);

  // Load partner link from Supabase once per session (overrides local partner id/label; keeps local email)
  useEffect(() => {
    if (!session || partnerLoadedFromServer) return;
    const loadLink = async () => {
      const { data, error } = await supabase
        .from("partner_links")
        .select("partner_user_id, label")
        .eq("user_id", session.user.id)
        .maybeSingle();
      if (!error && data) {
        setPartnerConfig((prev) => ({
          email: prev.email,
          userId: data.partner_user_id ?? prev.userId,
          label: data.label ?? prev.label,
        }));
        setPartnerFormUserId(data.partner_user_id ?? partnerFormUserId);
        setPartnerFormLabel(data.label ?? partnerFormLabel);
      }
      setPartnerLoadedFromServer(true);
    };
    loadLink();
  }, [session, partnerLoadedFromServer, partnerFormLabel, partnerFormUserId]);

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
        setSyncError("Son veriler alınamadı (yerel değerler kullanılıyor).");
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
        setSyncError("Supabase’e kaydedilemedi (yerelde tutuluyor).");
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
        setPartnerError("Eş verisi alınamadı (paylaşım/izinleri kontrol et).");
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
    const nextLabel = partnerFormLabel.trim() || "Eş";

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
        setPartnerError(
          "E-posta ile kullanıcı ID’si çözülemedi. Kullanıcı ID’sini elle girin veya çözücüyü düzeltin."
        );
        setPartnerSaving(false);
        return;
      }
    }

    if (!nextId) {
      setPartnerError(
        "Eş kullanıcı ID’si girin (ya da çözücü + e‑posta kullanın)."
      );
      setPartnerSaving(false);
      return;
    }

    setPartnerConfig({ email: nextEmail, userId: nextId, label: nextLabel });
    if (session) {
      const { error } = await supabase.from("partner_links").upsert(
        {
          user_id: session.user.id,
          partner_user_id: nextId,
          label: nextLabel,
        },
        { onConflict: "user_id" }
      );
      if (error) {
        console.error("Failed to save partner link", error);
        setPartnerError(
          "Eş bilgisi sunucuya kaydedilemedi; sadece yerelde saklandı."
        );
      } else {
        setPartnerStatus(
          "Eş kaydedildi (senkronize). Erişimi paylaştıklarından emin ol."
        );
      }
    } else {
      setPartnerStatus("Eş yerelde kaydedildi. Senkron için giriş yap.");
    }
    setPartnerSaving(false);
  };

  const clearPartner = () => {
    setPartnerConfig({ email: "", userId: "", label: "Eş" });
    setPartnerFormEmail("");
    setPartnerFormUserId("");
    setPartnerFormLabel("Eş");
    setPartnerStatus(null);
    setPartnerError(null);
    setPartnerLoadedFromServer(false);
  };

  if (sessionLoading) {
    return (
      <div className="app-shell">
        <div className="card">
          <p className="muted">Oturum kontrol ediliyor…</p>
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
              Su, Kaka ve Gaz Günlük Sayacı
            </h1>
            <p className="muted">
              Giriş yaparak kayıtlarını sakla; su, kaka ve gaz sayıları hesabına
              özel kalsın.
            </p>
          </div>
        </header>
        <AuthForm />
        <p className="muted card mt-5!">
          Görmek ve kaydetmek için giriş yapmalısın. Sana verilen
          e‑posta/şifreyi kullan.
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
          Bugün
        </button>
        <button
          className={`nav__item${
            activeView === "history" ? " nav__item--active" : ""
          }`}
          onClick={() => setActiveView("history")}
        >
          Takvim
        </button>
      </div>

      {activeView === "today" && (
        <main>
          <div className="card auth-bar mt-4!">
            <div>
              <p className="label">Giriş yapıldı</p>
              <p className="muted">{session.user.email}</p>
            </div>
            <button className="ghost" onClick={signOut}>
              Çıkış yap
            </button>
          </div>
          <header className="card app-header mb-4! mt-4!">
            <div className="pill">Bugün · {displayDate}</div>
            <section className="card summary-card">
              <p className="label">Bugünkü toplamlar</p>
              <div className="summary-grid two-up">
                <div className="stat-block">
                  <p className="muted font-bold! text-base!">Ben</p>
                  <div className="stat-row">
                    <span className="chip">Su: {waterLiters} L</span>
                    <span className="chip">Kaka: {state.poop}</span>
                    <span className="chip">Gaz: {state.farts}</span>
                  </div>
                </div>
                {partnerConfig.userId && (
                  <div className="stat-block">
                    <p className="muted font-bold! text-base!">
                      {partnerConfig.label}
                    </p>
                    <div className="stat-row">
                      <span className="chip">
                        Su: {(partnerToday?.waterMl ?? 0) / 1000} L
                      </span>
                      <span className="chip">
                        Kaka: {partnerToday?.poop ?? 0}
                      </span>
                      <span className="chip">
                        Gaz: {partnerToday?.farts ?? 0}
                      </span>
                    </div>
                    {partnerError && <div className="pill">{partnerError}</div>}
                    {!partnerError && !partnerToday && (
                      <div className="pill">
                        Bugün {partnerConfig.label} için veri yok.
                      </div>
                    )}
                  </div>
                )}
              </div>
            </section>
          </header>
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
            <div className="partner-header">
              <div>
                <p className="label">Eş erişimi</p>
                {partnerConfig.userId && (
                  <p className="muted">
                    {partnerConfig.label}: {partnerConfig.userId.slice(0, 6)}…
                  </p>
                )}
              </div>
              <button
                className="ghost"
                type="button"
                onClick={() => setPartnerFormOpen((v) => !v)}
              >
                {partnerFormOpen ? "Kapat" : "Düzenle"}
              </button>
            </div>
            {partnerFormOpen && (
              <>
                <p className="muted">
                  Eşinin e-postasını (çözücü ile) veya kullanıcı ID’sini gir;
                  bugünkü toplamlarını görebilmek için. Onların da veriyi
                  seninle paylaşmış olması gerekir.
                </p>
                <div className="auth-inputs">
                  <input
                    type="email"
                    placeholder="partner@example.com (isteğe bağlı)"
                    value={partnerFormEmail}
                    onChange={(e) => setPartnerFormEmail(e.target.value)}
                  />
                  <input
                    type="text"
                    placeholder="Eş kullanıcı ID’si"
                    value={partnerFormUserId}
                    onChange={(e) => setPartnerFormUserId(e.target.value)}
                  />
                  <input
                    type="text"
                    placeholder="Etiket"
                    value={partnerFormLabel}
                    onChange={(e) => setPartnerFormLabel(e.target.value)}
                  />
                </div>
                <div className="actions-grid">
                  <button
                    onClick={savePartner}
                    disabled={partnerSaving}
                    type="button"
                  >
                    {partnerSaving ? "Kaydediliyor..." : "Eşi kaydet"}
                  </button>
                  <button
                    className="ghost"
                    onClick={clearPartner}
                    type="button"
                  >
                    Temizle
                  </button>
                </div>
                {partnerStatus && <p className="pill">{partnerStatus}</p>}
                {partnerError && <p className="pill">{partnerError}</p>}
                {!PARTNER_RESOLVER_URL && (
                  <p className="muted">
                    İpucu: e‑posta → kullanıcı ID çözücüsü için
                    VITE_PARTNER_RESOLVER_URL ekleyebilirsin.
                  </p>
                )}
              </>
            )}
          </section>
        </main>
      )}

      {activeView === "history" && (
        <main>
          <section className="card">
            <p className="label">Tarih seç</p>
            <DayPicker
              locale={tr}
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
            <p className="label">Seçilen gün</p>
            <h2>{selectedKey}</h2>
            {selectedSummary ? (
              <div className="summary-grid">
                <div className="pill">
                  Su: {(selectedSummary.waterMl / 1000).toFixed(2)} L
                </div>
                <div className="pill">Kaka: {selectedSummary.poop}</div>
                <div className="pill">Gaz: {selectedSummary.farts}</div>
              </div>
            ) : (
              <p className="muted">Bu gün için henüz kayıt yok.</p>
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
