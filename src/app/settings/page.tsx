import type { Metadata } from "next";
import { SettingsScreen } from "@/features/settings/SettingsScreen";
import { getAuth } from "@/server/auth/auth-runtime";
import { signOutAction } from "@/app/sign-in/actions";
import { readSavedAppearance } from "@/features/settings/saved-appearance";
import { updateAppearanceAction } from "@/features/settings/appearance-actions";
import {
  getWeatherSettingsAction,
  updateWeatherSettingsAction,
} from "@/features/settings/weather-actions";
import { closeAccountAction } from "@/features/settings/close-account-actions";
import { accountClosureEnabled } from "@/server/auth/account-closure-rollout";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  // The proxy already keeps signed-out visitors out; this only reads whose account to show.
  const [session, weather, appearance] = await Promise.all([
    (await getAuth()).provider.getSession(),
    getWeatherSettingsAction(),
    readSavedAppearance(),
  ]);
  return (
    <SettingsScreen
      email={session?.email ?? null}
      signOut={signOutAction}
      initialWeather={weather.settings}
      updateWeather={updateWeatherSettingsAction}
      initialAppearance={appearance}
      updateAppearance={updateAppearanceAction}
      accountClosureEnabled={accountClosureEnabled()}
      closeAccount={closeAccountAction}
    />
  );
}
