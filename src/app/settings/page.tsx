import type { Metadata } from "next";
import { SettingsScreen } from "@/features/settings/SettingsScreen";
import { getAuth } from "@/server/auth/auth-runtime";
import { signOutAction } from "@/app/sign-in/actions";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  // The proxy already keeps signed-out visitors out; this only reads whose account to show.
  const session = await (await getAuth()).provider.getSession();
  return <SettingsScreen email={session?.email ?? null} signOut={signOutAction} />;
}
