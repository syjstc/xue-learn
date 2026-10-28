import {
  assertPersonalSyncTableCoverage,
  personalSyncTableManifest,
} from "./manifest.js";

describe("personal sync table manifest", () => {
  it("synchronizes portable user settings without treating credentials as workspace data", () => {
    expect(personalSyncTableManifest.UserSettings).toEqual({
      policy: "leased_replace",
      scope: "workspace",
    });
    expect(personalSyncTableManifest.UserSettings).not.toHaveProperty(
      "credentials",
    );
  });

  it("classifies the SQLite FTS5 table and all of its shadow tables as derived", () => {
    const tables = [
      "RagChunkFts",
      "RagChunkFts_config",
      "RagChunkFts_content",
      "RagChunkFts_data",
      "RagChunkFts_docsize",
      "RagChunkFts_idx",
    ];

    expect(() => assertPersonalSyncTableCoverage(tables)).not.toThrow();
    for (const table of tables) {
      expect(personalSyncTableManifest[table]).toEqual({
        policy: "derived_rebuild",
        scope: "local",
      });
    }
  });

  it("still rejects an unclassified application table", () => {
    expect(() => assertPersonalSyncTableCoverage(["UnexpectedTable"])).toThrow(
      "Personal sync table manifest is missing: UnexpectedTable",
    );
  });
});

it("keeps schema ownership metadata local and tolerates only host-validated historical extensions",()=>{
 expect(personalSyncTableManifest.ElectronLearningSchemaAdoption.policy).toBe("device_local");
 expect(()=>assertPersonalSyncTableCoverage(["HistoricalExtension"],{validatedLegacyTables:["HistoricalExtension"]})).not.toThrow();
 expect(()=>assertPersonalSyncTableCoverage(["UnexpectedTable"],{validatedLegacyTables:["HistoricalExtension"]})).toThrow();
});
