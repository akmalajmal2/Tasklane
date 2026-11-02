/** E-mail notification groups. The ids must match public._email_group() in the database. */
export const EMAIL_GROUPS = [
  { id: "assignments", label: "Assignments", hint: "A task is assigned to you or taken away from you" },
  { id: "proposals", label: "Proposals", hint: "Proposed tasks are submitted, approved or declined" },
  { id: "reviews", label: "Reviews and testing", hint: "Cards move to review or testing, are approved, sent back, or pass or fail testing" },
  { id: "overdue", label: "Overdue tasks", hint: "An in-progress task passes its due date" },
  { id: "comments", label: "Comments", hint: "Someone comments on a task assigned to you or proposed by you" },
] as const;
