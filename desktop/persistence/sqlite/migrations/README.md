# Electron learning schema history

Fresh workspaces use `../learning-schema.v1.json` through the transaction-owning `migrateElectronLearningSchema` gate. The reviewed baseline contains only local learning, SQLite infrastructure and personal-sync models. It does not replay the former mixed product migration history.

The supported legacy schema is verified by complete owned table/key/index/constraint definitions and migration/extension fingerprints before an independent `ElectronLearningSchemaAdoption` record is written. Former migration records, legacy identity columns, extension tables and all content remain intact. Unsupported or incomplete libraries fail before writes. Removing old extension data is a separate explicit operation.
