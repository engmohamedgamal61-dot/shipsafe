import { MarketingNav } from "@/components/marketing/nav";
import { Hero } from "@/components/marketing/hero";
import { ReviewerLineup } from "@/components/marketing/reviewer-lineup";
import { SeverityExplainer } from "@/components/marketing/severity-explainer";
import { MarketingFooter } from "@/components/marketing/footer";

export default function LandingPage() {
  return (
    <div className="flex flex-1 flex-col">
      <MarketingNav />
      <main className="flex-1">
        <Hero />
        <ReviewerLineup />
        <SeverityExplainer />
      </main>
      <MarketingFooter />
    </div>
  );
}
