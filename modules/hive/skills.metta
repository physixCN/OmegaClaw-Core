(= (hive-publish $statement $f $c)
   (py-call (hive_commons.publish (repr $statement) $f $c)))

(= (hive-query $pattern)
   (py-call (hive_commons.query (repr $pattern))))

(= (hive-belief $statement)
   (py-call (hive_commons.belief (repr $statement))))
