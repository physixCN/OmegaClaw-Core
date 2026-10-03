(= (hive-publish $statement $f $c)
   (py-call (hive_commons.publish (repr $statement) $f $c)))

(= (hive-query $pattern)
   (py-call (hive_commons.query (repr $pattern))))

(= (hive-belief $statement)
   (py-call (hive_commons.belief (repr $statement))))

(= (hive-goals)
   (py-call (hive_commons.goals)))

(= (hive-goal-claim $id)
   (py-call (hive_commons.goal_claim $id)))

(= (hive-goal-done $id $result)
   (py-call (hive_commons.goal_finish $id "done" $result)))

(= (hive-goal-fail $id $reason)
   (py-call (hive_commons.goal_finish $id "failed" $reason)))

(= (hive-goal-create $parent $title)
   (py-call (hive_commons.goal_create $parent $title)))

; ---- loop hooks (declared in entry.metta; only act when commchannel=hive) ----

(= (hive-mode?)
   (== (commchannel) hive))

(= (hive-report-trace)
   (if (hive-mode?)
       (py-call (hive_commons.trace (get-state &cycle)
                                    (if (get-state &lastResponseMsgNew) (get-state &prevmsg) "")
                                    (get-state &lastResponseText)
                                    (repr (get-state &lastResponseResults))))
       hive-trace-off))

(= (hive-apply-ops $ops)
   (if (== $ops ())
       hive-control-done
       (progn (hive-apply-op (car-atom $ops))
              (hive-apply-ops (cdr-atom $ops)))))

(= (hive-apply-op (retire $space $text))
   (let* (($handle (space-handle $space))
          ($atom (sread $text)))
         (remove-atom $handle $atom)))

(= (hive-apply-op (reset))
   (collapse (match &self (SpaceRegistry $name $handle memory)
                    (remove-all-atoms $handle))))

(= (hive-run-control)
   (if (hive-mode?)
       (hive-apply-ops (sread (py-call (hive_commons.take_control))))
       hive-control-off))
