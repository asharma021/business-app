import { requireUser } from "@/auth";
import { financingDefaultsOf, getOrCreatePreference, weightsOf } from "@/lib/preferences";
import { features } from "@/lib/env";
import { PageHeader, Panel } from "@/components/ui";
import { SendTestEmailButton } from "@/components/ops-buttons";
import { SettingsForm } from "./settings-form";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await requireUser();
  const pref = await getOrCreatePreference(user.id, user.email);
  return (
    <>
      <PageHeader title="Settings" description="Your goals, financing assumptions, scoring weights and report schedule. Saving re-scores every opportunity." />
      <SettingsForm
        pref={{ ...pref, updatedAt: undefined }}
        financing={financingDefaultsOf(pref)}
        weights={weightsOf(pref)}
        userEmail={user.email}
        emailConfigured={features.email()}
      />
      <div className="mt-6 max-w-4xl">
        <Panel title="Email delivery">
          <p className="mb-3 text-sm text-muted">Sends a short message to {pref.reportEmail ?? user.email} through Resend to confirm your key and sending domain work. Save settings first if you changed the address.</p>
          <SendTestEmailButton />
        </Panel>
      </div>
    </>
  );
}
