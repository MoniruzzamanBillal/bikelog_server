"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.aiValidations = void 0;
const zod_1 = require("zod");
const bikeChatSchema = zod_1.z.object({
    body: zod_1.z.object({
        messages: zod_1.z
            .array(zod_1.z.object({
            // ! only user/assistant accepted — a client-supplied "system" message is rejected here
            // ! (400), since the system prompt is always server-constructed from real bike data
            role: zod_1.z.enum(["user", "assistant"], {
                required_error: "role is required",
            }),
            content: zod_1.z.string({ required_error: "content is required" }),
        }))
            .nonempty("messages must be a non-empty array"),
    }),
});
//
exports.aiValidations = {
    bikeChatSchema,
};
