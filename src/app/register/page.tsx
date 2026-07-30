import { AuthForm } from "../login/AuthForm";
import { formatPence } from "@/lib/money";
import { OPENING_BALANCE_MINOR } from "@/modules/wallet";

export const dynamic = "force-dynamic";

export default function RegisterPage() {
  return (
    <main id="main">
      <h1>Create an account</h1>
      <p>
        You start with {formatPence(OPENING_BALANCE_MINOR)} of virtual money.
        There are no deposits, no withdrawals, and no real money anywhere in this
        product.
      </p>
      <AuthForm mode="register" />
      <p>
        Already registered? <a href="/login">Sign in</a>.
      </p>
    </main>
  );
}
