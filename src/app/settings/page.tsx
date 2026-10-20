import type { Metadata } from "next";
import { SettingsScreen } from "@/features/settings/SettingsScreen";
import { getAuth } from "@/server/auth/auth-runtime";
import { signOutAction } from "@/app/sign-in/actions";
import {
  getWeatherSettingsAction,
  updateWeatherSettingsAction,
} from "@/features/settings/weather-actions";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  // The proxy already keeps signed-out visitors out; this only reads whose account to show.
  const [session, weather] = await Promise.all([
    (await getAuth()).provider.getSession(),
    getWeatherSettingsAction(),
  ]);
  return (
    <SettingsScreen
      email={session?.email ?? null}
      signOut={signOutAction}
      initialWeather={weather.settings}
      updateWeather={updateWeatherSettingsAction}
    />
  );
}
