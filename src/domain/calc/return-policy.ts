// What turning the dedicated return outfit off means for everyday quantities.
// Decided by Caroline on 2026-10-23 (#25, #205): the dedicated return outfit replaces ONE everyday outfit, for the checkout
// day. With it on, that day is worn in the return outfit and needs no everyday look; with it off, the checkout day needs an
// everyday look like any other day ("add-return-day-back"). The prototype's "exclude-return-day" (the return day never
// counted, even with no return outfit) silently under-packed. RETURN_OFF_POLICY stays the one switch point.
export type ReturnOffPolicy = "exclude-return-day" | "add-return-day-back";
export const RETURN_OFF_POLICY: ReturnOffPolicy = "add-return-day-back";
