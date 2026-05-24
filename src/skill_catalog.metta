(= (getSkills)
   (repr (list_to_set (collapse (match &self (SkillCatalog $line) $line)))))

(= (skill-help $topic)
   (let* (($exact (collapse (match &self (SkillHelp $topic $line) $line)))
          ($symbol (repr $topic))
          ($by-symbol (collapse (match &self (SkillHelp $symbol $line) $line))))
         (repr (list_to_set (append $exact $by-symbol)))))
