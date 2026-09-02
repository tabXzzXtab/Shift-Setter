import { AuthGate } from "@/components/auth-gate";
import { Home } from "@/components/home";

export default function Page() {
  return (
    <AuthGate>
      <Home />
    </AuthGate>
  );
}
