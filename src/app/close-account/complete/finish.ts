export interface FinishAccountClosureDependencies {
  consume: () => Promise<boolean>;
  cleanup: () => Promise<void>;
  navigate: () => void;
}

export const ACCOUNT_CLOSURE_STEP_TIMEOUT_MS = 3_000;

function within<T>(work: Promise<T>, fallback: T): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(() => resolve(fallback), ACCOUNT_CLOSURE_STEP_TIMEOUT_MS);
    work.then(
      (value) => {
        globalThis.clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        globalThis.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** Always leave the deleted account behind; cleanup is best effort and runs only after proof consumption succeeds. */
export async function finishAccountClosure({
  consume,
  cleanup,
  navigate,
}: FinishAccountClosureDependencies): Promise<void> {
  try {
    if (await within(consume(), false)) await within(cleanup(), undefined);
  } finally {
    navigate();
  }
}
