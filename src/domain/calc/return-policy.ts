// What turning the dedicated return outfit off means for everyday quantities.
// Current prototype behavior is "exclude-return-day": the return day is never
// counted, even with no return outfit. The alternative adds that day back.
// TODO(#25): decide, then change RETURN_OFF_POLICY (the only switch point).
export type ReturnOffPolicy = "exclude-return-day" | "add-return-day-back";
export const RETURN_OFF_POLICY: ReturnOffPolicy = "exclude-return-day";
