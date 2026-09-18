import Link from "next/link";
import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { isSupabaseConfigured } from "@/lib/env";
import { CredentialsForm } from "@/components/auth/credentials-form";
import { signUpWithPassword } from "@/app/actions/sign-in";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export default function SignUpPage() {
  if (!isSupabaseConfigured) {
    redirect("/sign-in");
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 py-16">
      <Link href="/" className="flex items-center gap-2 font-semibold">
        <ShieldCheck className="h-5 w-5 text-brand" aria-hidden />
        ShipSafe
      </Link>

      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Create an account</CardTitle>
          <CardDescription>Start reviewing pull requests with ShipSafe.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4">
            <CredentialsForm action={signUpWithPassword} submitLabel="Sign up" requireConfirmPassword />
            <p className="text-center text-sm text-muted-foreground">
              Already have an account?{" "}
              <Link href="/sign-in" className="font-medium text-brand">
                Sign in
              </Link>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
