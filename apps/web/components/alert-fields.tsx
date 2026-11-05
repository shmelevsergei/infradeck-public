"use client";
import { useState } from "react";
import { useTranslate } from "./locale";

// The parent revision key applies canonical saved values; failed saves retain drafts.
export function AlertFields({
  status,
  assignee,
}: {
  status: string;
  assignee: string;
}) {
  const t = useTranslate();
  const [draftStatus, setStatus] = useState(status);
  const [draftAssignee, setAssignee] = useState(assignee);
  const [comment, setComment] = useState("");
  return (
    <>
      <label className="field">
        <span>{t("Status")}</span>
        <select
          name="status"
          value={draftStatus}
          onChange={(event) => setStatus(event.target.value)}
        >
          {["OPEN", "ACKNOWLEDGED", "RESOLVED"].map((value) => (
            <option key={value} value={value}>
              {t(value)}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>{t("Assignee")}</span>
        <input
          name="assignee"
          value={draftAssignee}
          onChange={(event) => setAssignee(event.target.value)}
        />
      </label>
      <label className="field">
        <span>{t("Comment")}</span>
        <input
          name="comment"
          value={comment}
          onChange={(event) => setComment(event.target.value)}
        />
      </label>
    </>
  );
}
