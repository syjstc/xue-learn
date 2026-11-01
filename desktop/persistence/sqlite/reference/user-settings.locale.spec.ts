import { execFileSync } from "node:child_process";

// MikroORM 7 is ESM. Exercise its real driver outside the CommonJS Jest runtime.
test("new settings follow the system on the old schema and preserve saved choices", () => {
  execFileSync(
    process.execPath,
    [
      "--experimental-transform-types",
      "--input-type=module",
      "-e",
      String.raw`
    import assert from 'node:assert/strict';
    import { MikroORM } from '@mikro-orm/sqlite';
    import { UserSchema, UserEntity } from './user.entity.ts';
    import { UserSettingsSchema } from './user-settings.entity.ts';
    import { MikroOrmUserSettingsRepository } from './user-settings.repository.ts';
    const orm = await MikroORM.init({ dbName: ':memory:', entities: [UserSchema, UserSettingsSchema] });
    try {
      const schema = await orm.schema.getCreateSchemaSQL();
      const legacy = schema.replace(/([\x60"]uiLocale[\x60"].*?default\s+)'system'/i, "$1'zh-Hans'");
      assert.notEqual(legacy, schema);
      await orm.schema.execute(legacy);
      const em = orm.em.fork();
      await em.insert(UserEntity, { id: 'locale-owner', name: 'Synthetic locale learner', createdAt: new Date(), updatedAt: new Date() });
      const repository = new MikroOrmUserSettingsRepository(em);
      assert.equal((await repository.upsert({ userId: 'locale-owner', patch: { chatModel: 'fixture-model' } })).uiLocale, 'system');
      await repository.upsert({ userId: 'locale-owner', patch: { uiLocale: 'en' } });
      await repository.upsert({ userId: 'locale-owner', patch: { searchEnabled: false } });
      assert.equal((await repository.findByUserId('locale-owner'))?.uiLocale, 'en');
      await repository.upsert({ userId: 'locale-owner', patch: { uiLocale: 'zh-Hans' } });
      await repository.upsert({ userId: 'locale-owner', patch: { chatModel: 'another-fixture' } });
      assert.equal((await repository.findByUserId('locale-owner'))?.uiLocale, 'zh-Hans');
    } finally { await orm.close(true); }
  `,
    ],
    { cwd: __dirname, timeout: 15000, stdio: "pipe" },
  );
}, 20000);
