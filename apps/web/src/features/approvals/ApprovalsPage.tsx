import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { api, describeError } from "../../shared/lib/api";
import { formatDay, formatNumber } from "../../shared/lib/format";
import { DURATION, EASE } from "../../shared/theme/motion";
import { Badge, Button, Field, Notice, Page, QueryView } from "../../shared/ui";
import type { Entry } from "../timesheet/TimesheetPage";

export function ApprovalsPage() {
  const qc = useQueryClient();
  const queue = useQuery({ queryKey: ["approvals"], queryFn: () => api<Entry[]>("/api/grants/approvals") });
  const [returning, setReturning] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const decide = useMutation({
    mutationFn: (v: { id: string; decision: "approve" | "return"; reason?: string }) =>
      api(`/api/grants/time-entries/${v.id}/decision`, {
        method: "POST",
        body: v.decision === "approve" ? { decision: "approve" } : { decision: "return", reason: v.reason },
      }),
    onSuccess: (_r, v) => {
      setNotice(
        v.decision === "approve" ? "Approved." : "Returned with your reason; the person is notified.",
      );
      setReturning(null);
      setReason("");
      qc.invalidateQueries({ queryKey: ["approvals"] });
    },
  });
  return (
    <Page
      title="Approvals"
      lead="Hours submitted to the grants you lead. You decide on other people's hours, never your own."
    >
      <Notice message={notice} />
      <Notice message={decide.isError ? describeError(decide.error) : null} tone="danger" />
      <QueryView
        query={queue}
        loading="Loading entries to decide"
        empty={{
          title: "Nothing to decide",
          body: "When someone submits hours to a grant you lead, they appear here.",
        }}
      >
        {(list) => (
          <ul className="queue">
            <AnimatePresence initial={false}>
              {list.map((e) => (
                <motion.li
                  key={e.id}
                  className="queue__item"
                  layout
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: DURATION.base, ease: EASE.out }}
                >
                  <div className="queue__who">
                    <strong>{e.person_name}</strong>
                    <span>
                      {formatDay(e.work_date)}, {formatNumber(e.hours)} h on {e.grant_code}{" "}
                      {e.work_package_code}
                    </span>
                    <span className="queue__what">{e.activity}</span>
                    {e.late ? <Badge tone="warn">recorded late: not charged</Badge> : null}
                  </div>
                  {returning === e.id ? (
                    <form
                      className="queue__return"
                      onSubmit={(ev) => {
                        ev.preventDefault();
                        decide.mutate({ id: e.id, decision: "return", reason });
                      }}
                    >
                      <Field label="Why are you returning it?">
                        <input
                          className="input"
                          value={reason}
                          onChange={(ev) => setReason(ev.target.value)}
                          minLength={3}
                          required
                        />
                      </Field>
                      <Button type="submit" variant="danger" busy={decide.isPending}>
                        Return to {e.person_name.split(" ")[0]}
                      </Button>
                      <Button variant="quiet" onClick={() => setReturning(null)}>
                        Cancel
                      </Button>
                    </form>
                  ) : (
                    <div className="queue__actions">
                      <Button
                        onClick={() => decide.mutate({ id: e.id, decision: "approve" })}
                        busy={decide.isPending}
                      >
                        Approve
                      </Button>
                      <Button variant="secondary" onClick={() => setReturning(e.id)}>
                        Return
                      </Button>
                    </div>
                  )}
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </QueryView>
    </Page>
  );
}
