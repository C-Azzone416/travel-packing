"use client";

import { useActionState, useState } from "react";
import { signInAction } from "./actions";
import type { SignInState } from "./state";
import { SignInView } from "./SignInView";

const INITIAL_STATE: SignInState = { error: null };

export function SignInForm({ notice }: { notice?: string | null }) {
  const [state, action, pending] = useActionState(signInAction, INITIAL_STATE);
  const [showPassword, setShowPassword] = useState(false);
  return (
    <SignInView
      action={action}
      error={state.error}
      reference={state.reference}
      pending={pending}
      notice={notice}
      showPassword={showPassword}
      onTogglePassword={() => setShowPassword((current) => !current)}
    />
  );
}
