import { AuthForm } from "./AuthForm";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <main id="main">
      <h1>Sign in</h1>
      <AuthForm mode="login" />
      <p>
        No account? <a href="/register">Create one</a> — you get a virtual
        bankroll and no real money is involved anywhere.
      </p>
    </main>
  );
}
