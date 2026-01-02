import { useState } from "react";
import supabase from "../utils/supabase";

type Props = {
  onSignedIn?: () => void;
};

export default function AuthForm({ onSignedIn }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const signIn = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (signInError) {
      setError(signInError.message);
    } else {
      setEmail("");
      setPassword("");
      onSignedIn?.();
    }
    setLoading(false);
  };

  return (
    <form className="card auth-form gap-4!" onSubmit={signIn}>
      <div>
        <p className="label font-bold! text-lg!">Giriş yap</p>
      </div>
      <div className="auth-inputs gap-4!">
        <input
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          type="password"
          placeholder="Şifre"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>
      <button type="submit" disabled={loading}>
        {loading ? "Giriş yapılıyor..." : "Giriş yap"}
      </button>
      {error && <p className="pill">{error}</p>}
    </form>
  );
}
