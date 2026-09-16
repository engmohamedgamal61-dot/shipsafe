import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { isSupabaseConfigured } from "@/lib/env";
import { CredentialsForm } from "@/components/auth/credentials-form";
import { DemoCta } from "@/components/marketing/demo-cta";
import { signInWithPassword } from "@/app/actions/sign-in";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export default function SignInPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 py-16">
      <Link href="/" className="flex items-center gap-2 font-semibold">
        <ShieldCheck className="h-5 w-5 text-brand" aria-hidden />
        ShipSafe
      </Link>

      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>
            {isSupabaseConfigured
              ? "Sign in with your ShipSafe account."
              : "This deployment is running in demo mode — there's no real account system connected yet."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isSupabaseConfigured ? (
            <div className="flex flex-col gap-4">
              <CredentialsForm action={signInWithPassword} submitLabel="Sign in" />
              <p className="text-center text-sm text-muted-foreground">
                No account?{" "}
                <Link href="/sign-up" className="font-medium text-brand">
                  Sign up
                </Link>
              </p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <p className="text-center text-sm text-muted-foreground">
                Continue with the seeded demo account instead — it runs the
                real multi-agent review engine against a sample pull request.
              </p>
              <DemoCta className="w-full" />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
