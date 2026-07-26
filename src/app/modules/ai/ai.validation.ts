import { z } from "zod";

const bikeChatSchema = z.object({
  body: z.object({
    messages: z
      .array(
        z.object({
          // ! only user/assistant accepted — a client-supplied "system" message is rejected here
          // ! (400), since the system prompt is always server-constructed from real bike data
          role: z.enum(["user", "assistant"], {
            required_error: "role is required",
          }),
          content: z.string({ required_error: "content is required" }),
        }),
      )
      .nonempty("messages must be a non-empty array"),
  }),
});

//
export const aiValidations = {
  bikeChatSchema,
};
