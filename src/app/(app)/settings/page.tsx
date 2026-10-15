import { requireUser } from "@/auth";
import { financingDefaultsOf, getOrCreatePreference, weightsOf } from "@/lib/preferences";
import { features } from "@/lib/env";
import { PageHeader } from "@/components/ui";
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
    </>
  );
}
