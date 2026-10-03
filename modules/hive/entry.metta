; omegaclaw.hive.commons module.
; Lets an agent share beliefs with its swarm's commons in an OmegaDots Hive and
; read them back.  The hive validates statements, mints evidence ids and merges
; independent evidence by revision.

(Module omegaclaw.hive.commons)
(ModuleKind omegaclaw.hive.commons swarm-organ)
(ModuleVersion omegaclaw.hive.commons "0.1.0")
(ModuleEntrypoint omegaclaw.hive.commons "entry.metta")
(ModuleOptional omegaclaw.hive.commons True)
(ModuleDefaultEnabled omegaclaw.hive.commons True)
(ModuleImplementation omegaclaw.hive.commons hive-api-membrane)

(Provides omegaclaw.hive.commons (Skill hive-publish))
(Provides omegaclaw.hive.commons (Skill hive-query))
(Provides omegaclaw.hive.commons (Skill hive-belief))

(OrganPrinciple omegaclaw.hive.commons "The commons is shared memory between dots; private memory never leaves this agent unless published.")

(RuntimeDependency omegaclaw.hive.commons python ">=3.10")
(RuntimeConfig omegaclaw.hive.commons HIVE_API_URL "runtime-config")
(RuntimeConfig omegaclaw.hive.commons HIVE_WS_TOKEN "runtime-secret")

(TraceWrites omegaclaw.hive.commons HiveBeliefPublished)

!(import! &self (car-atom (collapse (library OmegaClaw-Core ./modules/hive/src/hive_commons.py))))
!(import! &self (library OmegaClaw-Core ./modules/hive/catalog.metta))
!(import! &self (library OmegaClaw-Core ./modules/hive/affordance.metta))
!(import! &self (library OmegaClaw-Core ./modules/hive/signatures.metta))
!(import! &self (library OmegaClaw-Core ./modules/hive/skills.metta))
