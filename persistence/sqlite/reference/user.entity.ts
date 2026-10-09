import { EntitySchema } from "@mikro-orm/core";
/** Scalar identity-root metadata needed by learner-owned foreign keys. */
export class UserEntity {
    id!: string;
    email: string | null = null;
    name: string | null = null;
    createdAt!: Date;
    updatedAt!: Date;
}
export const UserSchema = new EntitySchema<UserEntity>({
    class: UserEntity,
    name: "User",
    tableName: "User",
    properties: {
        id: {
            type: String,
            columnType: "text",
            primary: true,
            fieldName: "id",
        },
        email: {
            type: String,
            columnType: "text",
            nullable: true,
            fieldName: "email",
        },
        name: {
            type: String,
            columnType: "text",
            nullable: true,
            fieldName: "name",
        },
        createdAt: {
            type: Date,
            columnType: "timestamp(3)",
            defaultRaw: "CURRENT_TIMESTAMP",
            fieldName: "createdAt",
            onCreate: () => new Date(),
        },
        updatedAt: {
            type: Date,
            columnType: "timestamp(3)",
            fieldName: "updatedAt",
            onCreate: () => new Date(),
            onUpdate: () => new Date(),
        },
    },
    uniques: [
        { name: "User_email_key", properties: ["email"] },
        { name: "User_name_key", properties: ["name"] },
    ],
});
